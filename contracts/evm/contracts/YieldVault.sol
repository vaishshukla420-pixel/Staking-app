// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626, ERC20, IERC20, Math} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

/// @title YieldVault — ERC-4626 auto-allocating yield vault
/// @notice Users deposit an asset (USDC, WETH, wSOL, ...) and receive shares.
///         The vault pushes pooled funds into exactly one active strategy
///         (Aave v3 / Compound v3 / Morpho adapter). Anyone may call
///         `rebalance` to move funds to a whitelisted strategy paying a
///         sufficiently higher APR (keeper/owner may force it). Yield accrues
///         to the share price; on `harvest` the protocol mints itself shares
///         worth `performanceFeeBps` of the profit — that is the spread.
contract YieldVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 3_000; // 30% of yield, hard cap

    /// @notice Strategy currently holding the pooled funds (address(0) = idle in vault)
    IStrategy public activeStrategy;
    /// @notice Whitelist of strategies funds may be moved into
    mapping(address => bool) public isStrategy;
    address[] public strategies;

    /// @notice Receives performance-fee shares
    address public treasury;
    /// @notice Share of harvested profit kept by the protocol, in bps
    uint256 public performanceFeeBps;
    /// @notice Max total assets accepted (risk limit); 0 means closed
    uint256 public depositCap;

    /// @notice High-water mark used to measure profit between harvests
    uint256 public lastTotalAssets;

    /// @notice Addresses allowed to force rebalances and pause
    mapping(address => bool) public isKeeper;
    /// @notice Min APR improvement (bps) required for a permissionless rebalance
    uint256 public minRebalanceImprovementBps;
    /// @notice Min delay between permissionless rebalances
    uint256 public rebalanceCooldown;
    uint256 public lastRebalanceAt;

    event StrategyAdded(address indexed strategy);
    event StrategyRemoved(address indexed strategy);
    event Rebalanced(address indexed from, address indexed to, uint256 assetsMoved, uint256 fromAprBps, uint256 toAprBps);
    event Harvested(uint256 profit, uint256 feeAssets, uint256 feeShares);
    event KeeperSet(address indexed keeper, bool allowed);
    event TreasurySet(address indexed treasury);
    event PerformanceFeeSet(uint256 feeBps);
    event DepositCapSet(uint256 cap);
    event RebalanceConfigSet(uint256 minImprovementBps, uint256 cooldown);
    event EmergencyWithdrawal(uint256 assetsRecovered);

    error NotKeeperOrOwner();
    error UnknownStrategy();
    error StrategyAssetMismatch();
    error StrategyVaultMismatch();
    error StrategyAlreadyActive();
    error StrategyInUse();
    error ImprovementTooSmall(uint256 currentAprBps, uint256 newAprBps, uint256 requiredImprovementBps);
    error CooldownActive(uint256 readyAt);
    error FeeTooHigh();
    error ZeroAddress();
    error WithdrawShortfall(uint256 requested, uint256 available);

    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner() && !isKeeper[msg.sender]) revert NotKeeperOrOwner();
        _;
    }

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address treasury_,
        uint256 performanceFeeBps_,
        uint256 depositCap_
    ) ERC4626(asset_) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        performanceFeeBps = performanceFeeBps_;
        depositCap = depositCap_;
        minRebalanceImprovementBps = 50; // 0.5% APR improvement required by default
        rebalanceCooldown = 6 hours;
        emit TreasurySet(treasury_);
        emit PerformanceFeeSet(performanceFeeBps_);
        emit DepositCapSet(depositCap_);
    }

    // ---------------------------------------------------------------------
    // ERC-4626 accounting
    // ---------------------------------------------------------------------

    /// @dev Idle balance in the vault plus whatever the active strategy reports
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (address(activeStrategy) == address(0)) return idle;
        return idle + activeStrategy.totalAssets();
    }

    /// @dev Virtual-share offset makes first-depositor share-inflation attacks
    ///      unprofitable and bounds victim rounding loss to negligible dust
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 total = totalAssets();
        if (total >= depositCap) return 0;
        return depositCap - total;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assetsRoom = maxDeposit(receiver);
        if (assetsRoom == 0) return 0;
        if (assetsRoom == type(uint256).max) return type(uint256).max;
        return convertToShares(assetsRoom);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
        // New principal is not profit: move the high-water mark up with it.
        lastTotalAssets += assets;
        _pushToStrategy();
    }

    /// @dev Withdrawals are intentionally never pausable — users can always exit.
    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        IERC20 token = IERC20(asset());
        uint256 idle = token.balanceOf(address(this));
        if (idle < assets && address(activeStrategy) != address(0)) {
            activeStrategy.withdraw(assets - idle, address(this));
            idle = token.balanceOf(address(this));
        }
        if (idle < assets) revert WithdrawShortfall(assets, idle);
        super._withdraw(caller, receiver, owner_, assets, shares);
        // Withdrawn principal leaves the high-water mark too (saturating: the
        // portion above the mark is unharvested profit walking out the door).
        lastTotalAssets = lastTotalAssets > assets ? lastTotalAssets - assets : 0;
    }

    // ---------------------------------------------------------------------
    // Yield: harvest & performance fee (the protocol spread)
    // ---------------------------------------------------------------------

    /// @notice Realize profit since the last harvest and mint the protocol's
    ///         fee to the treasury as shares. Callable by anyone: the fee only
    ///         ever takes a slice of *new profit*, never principal.
    function harvest() public returns (uint256 feeShares) {
        uint256 total = totalAssets();
        uint256 highWater = lastTotalAssets;
        if (total <= highWater) return 0;

        uint256 profit = total - highWater;
        uint256 feeAssets = (profit * performanceFeeBps) / BPS;
        if (feeAssets > 0) {
            // Mint shares worth `feeAssets` after dilution, mirroring OZ's
            // virtual-share math so pricing stays consistent.
            feeShares = feeAssets.mulDiv(
                totalSupply() + 10 ** _decimalsOffset(),
                total - feeAssets + 1,
                Math.Rounding.Floor
            );
            if (feeShares > 0) _mint(treasury, feeShares);
        }
        lastTotalAssets = total;
        emit Harvested(profit, feeAssets, feeShares);
    }

    // ---------------------------------------------------------------------
    // Strategy management & rebalancing
    // ---------------------------------------------------------------------

    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    /// @notice Gross APR (bps) currently earned by the pooled funds
    function currentAPRBps() external view returns (uint256) {
        if (address(activeStrategy) == address(0)) return 0;
        return activeStrategy.currentAPRBps();
    }

    /// @notice The whitelisted strategy with the highest APR right now
    function bestStrategy() public view returns (address best, uint256 bestAprBps) {
        uint256 n = strategies.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 apr = IStrategy(strategies[i]).currentAPRBps();
            if (best == address(0) || apr > bestAprBps) {
                best = strategies[i];
                bestAprBps = apr;
            }
        }
    }

    function addStrategy(address strategy) external onlyOwner {
        if (strategy == address(0)) revert ZeroAddress();
        if (isStrategy[strategy]) revert StrategyAlreadyActive();
        if (IStrategy(strategy).asset() != asset()) revert StrategyAssetMismatch();
        if (IStrategy(strategy).vault() != address(this)) revert StrategyVaultMismatch();
        isStrategy[strategy] = true;
        strategies.push(strategy);
        emit StrategyAdded(strategy);
    }

    function removeStrategy(address strategy) external onlyOwner {
        if (!isStrategy[strategy]) revert UnknownStrategy();
        if (strategy == address(activeStrategy)) revert StrategyInUse();
        isStrategy[strategy] = false;
        uint256 n = strategies.length;
        for (uint256 i = 0; i < n; i++) {
            if (strategies[i] == strategy) {
                strategies[i] = strategies[n - 1];
                strategies.pop();
                break;
            }
        }
        emit StrategyRemoved(strategy);
    }

    /// @notice Move all pooled funds to `newStrategy`.
    ///         Permissionless when the new venue's APR beats the current one by
    ///         `minRebalanceImprovementBps` and the cooldown has passed — the
    ///         contract itself verifies the move is profitable, so keepers
    ///         (Chainlink Automation, Gelato, or anyone) need no trust.
    ///         Owner/keepers may rebalance without those checks (e.g. to exit
    ///         a venue on risk grounds).
    function rebalance(address newStrategy) external nonReentrant {
        if (!isStrategy[newStrategy]) revert UnknownStrategy();
        IStrategy current = activeStrategy;
        if (newStrategy == address(current)) revert StrategyAlreadyActive();

        uint256 currentApr = address(current) == address(0) ? 0 : current.currentAPRBps();
        uint256 newApr = IStrategy(newStrategy).currentAPRBps();

        bool privileged = msg.sender == owner() || isKeeper[msg.sender];
        if (!privileged) {
            if (newApr < currentApr + minRebalanceImprovementBps) {
                revert ImprovementTooSmall(currentApr, newApr, minRebalanceImprovementBps);
            }
            uint256 readyAt = lastRebalanceAt + rebalanceCooldown;
            if (block.timestamp < readyAt) revert CooldownActive(readyAt);
        }

        // Lock in the fee on profit earned at the old venue before moving.
        harvest();

        uint256 moved;
        if (address(current) != address(0)) {
            moved = current.withdrawAll(address(this));
        }
        activeStrategy = IStrategy(newStrategy);
        _pushToStrategy();
        lastRebalanceAt = block.timestamp;

        // Withdraw-all rounding at the old venue must not register as profit/loss.
        lastTotalAssets = totalAssets();

        emit Rebalanced(address(current), newStrategy, moved, currentApr, newApr);
    }

    /// @dev Push the vault's idle balance into the active strategy
    function _pushToStrategy() internal {
        IStrategy strategy = activeStrategy;
        if (address(strategy) == address(0)) return;
        IERC20 token = IERC20(asset());
        uint256 idle = token.balanceOf(address(this));
        if (idle == 0) return;
        token.safeTransfer(address(strategy), idle);
        strategy.deposit(idle);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setPerformanceFeeBps(uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh();
        // Charge pending profit at the old rate before changing it.
        harvest();
        performanceFeeBps = feeBps;
        emit PerformanceFeeSet(feeBps);
    }

    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    function setRebalanceConfig(uint256 minImprovementBps, uint256 cooldown) external onlyOwner {
        minRebalanceImprovementBps = minImprovementBps;
        rebalanceCooldown = cooldown;
        emit RebalanceConfigSet(minImprovementBps, cooldown);
    }

    function pause() external onlyKeeperOrOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Pull everything back from the strategy and pause deposits.
    ///         Users can still withdraw from the vault's idle balance.
    function emergencyWithdraw() external onlyKeeperOrOwner {
        IStrategy strategy = activeStrategy;
        uint256 recovered;
        if (address(strategy) != address(0)) {
            recovered = strategy.withdrawAll(address(this));
            activeStrategy = IStrategy(address(0));
        }
        if (!paused()) _pause();
        // Reset the high-water mark: venue losses (if any) must not be
        // charged as negative profit, and recovery must not be double-charged.
        lastTotalAssets = totalAssets();
        emit EmergencyWithdrawal(recovered);
    }
}
