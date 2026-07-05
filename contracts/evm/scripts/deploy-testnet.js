/**
 * Testnet (Sepolia) deployment against REAL venue addresses.
 *
 * Fill config/sepolia.json with the current official addresses first:
 *  - Aave v3 Sepolia Pool + aToken per asset:  https://docs.aave.com (Deployed Contracts)
 *  - Compound v3 Sepolia Comet per base asset: https://docs.compound.finance
 *  - A MetaMorpho ERC-4626 vault per asset:    https://docs.morpho.org
 * Any venue left as the zero address is skipped for that asset.
 *
 * Run: SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-testnet.js --network sepolia
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const cfgPath = path.join(__dirname, "..", "config", `${network.name}.json`);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with ${deployer.address} on ${network.name}`);

  const out = { network: network.name, treasury: cfg.treasury, vaults: {} };

  for (const [symbol, a] of Object.entries(cfg.assets)) {
    if (!a.token || a.token === ZERO) {
      console.log(`- ${symbol}: no token address, skipped`);
      continue;
    }
    const vault = await (
      await ethers.getContractFactory("YieldVault")
    ).deploy(a.token, `Yield ${symbol}`, `y${symbol}`, cfg.treasury, cfg.performanceFeeBps, BigInt(a.depositCap));
    console.log(`- ${symbol} vault: ${vault.target}`);
    const entry = { vault: vault.target, strategies: {} };

    if (a.aavePool && a.aavePool !== ZERO && a.aToken && a.aToken !== ZERO) {
      const s = await (
        await ethers.getContractFactory("AaveV3Strategy")
      ).deploy(vault.target, a.token, a.aavePool, a.aToken);
      await (await vault.addStrategy(s.target)).wait();
      entry.strategies.aave = s.target;
    }
    if (a.comet && a.comet !== ZERO) {
      const s = await (
        await ethers.getContractFactory("CompoundV3Strategy")
      ).deploy(vault.target, a.token, a.comet);
      await (await vault.addStrategy(s.target)).wait();
      entry.strategies.compound = s.target;
    }
    if (a.metaMorphoVault && a.metaMorphoVault !== ZERO) {
      const s = await (
        await ethers.getContractFactory("MorphoStrategy")
      ).deploy(vault.target, a.token, a.metaMorphoVault, cfg.aprReporter || deployer.address);
      await (await vault.addStrategy(s.target)).wait();
      entry.strategies.morpho = s.target;
    }

    if (cfg.keeper && cfg.keeper !== ZERO) await (await vault.setKeeper(cfg.keeper, true)).wait();

    const [best, bestApr] = await vault.bestStrategy();
    if (best !== ZERO && bestApr > 0n) {
      await (await vault.rebalance(best)).wait();
      console.log(`  activated best venue (${bestApr} bps): ${best}`);
    }

    if (symbol === "WETH") {
      const gateway = await (await ethers.getContractFactory("EthGateway")).deploy(a.token, vault.target);
      entry.ethGateway = gateway.target;
      console.log(`  ETH gateway: ${gateway.target}`);
    }
    out.vaults[symbol] = entry;
  }

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`Saved to deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
