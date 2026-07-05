/**
 * Local/demo deployment: mock tokens, mock Aave/Compound/Morpho venues,
 * one YieldVault per asset (USDC, WETH, wSOL), strategies wired and the
 * vaults rebalanced into the best venue. Writes ./deployments/localhost.json
 * (also consumed by the frontend — paste addresses into its config).
 *
 * Run:  npx hardhat node        (terminal 1)
 *       npm run deploy:local    (terminal 2)
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const FEE_BPS = 2000; // protocol keeps 20% of yield

async function deployAssetStack(deployer, treasury, token, symbol, cap, initialAprsBps) {
  const vault = await (
    await ethers.getContractFactory("YieldVault")
  ).deploy(token.target, `Yield ${symbol}`, `y${symbol}`, treasury, FEE_BPS, cap);

  const aavePool = await (await ethers.getContractFactory("MockAaveV3Pool")).deploy(token.target);
  const aave = await (
    await ethers.getContractFactory("AaveV3Strategy")
  ).deploy(vault.target, token.target, aavePool.target, aavePool.target);

  const comet = await (await ethers.getContractFactory("MockComet")).deploy(token.target);
  const compound = await (
    await ethers.getContractFactory("CompoundV3Strategy")
  ).deploy(vault.target, token.target, comet.target);

  const metaMorpho = await (await ethers.getContractFactory("MockMetaMorpho")).deploy(token.target);
  const morpho = await (
    await ethers.getContractFactory("MorphoStrategy")
  ).deploy(vault.target, token.target, metaMorpho.target, deployer.address);

  await (await vault.addStrategy(aave.target)).wait();
  await (await vault.addStrategy(compound.target)).wait();
  await (await vault.addStrategy(morpho.target)).wait();
  await (await vault.setKeeper(deployer.address, true)).wait();

  await (await aavePool.setAPRBps(initialAprsBps.aave)).wait();
  await (await comet.setAPRBps(initialAprsBps.compound)).wait();
  await (await metaMorpho.setAPRBps(initialAprsBps.morpho)).wait();
  await (await morpho.reportAPR(initialAprsBps.morpho)).wait();

  const [best] = await vault.bestStrategy();
  await (await vault.rebalance(best)).wait();

  return {
    vault: vault.target,
    strategies: { aave: aave.target, compound: compound.target, morpho: morpho.target },
    venues: { aavePool: aavePool.target, comet: comet.target, metaMorpho: metaMorpho.target },
    activeStrategy: best,
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = deployer.address; // demo: deployer collects the spread
  console.log(`Deploying with ${deployer.address} on ${network.name}`);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  const wsol = await MockERC20.deploy("Wrapped SOL", "wSOL", 9);
  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();

  const usdcStack = await deployAssetStack(deployer, treasury, usdc, "USDC",
    ethers.parseUnits("100000000", 6), { aave: 520, compound: 610, morpho: 680 });
  const wethStack = await deployAssetStack(deployer, treasury, weth, "WETH",
    ethers.parseEther("100000"), { aave: 240, compound: 190, morpho: 310 });
  const wsolStack = await deployAssetStack(deployer, treasury, wsol, "wSOL",
    ethers.parseUnits("10000000", 9), { aave: 410, compound: 0, morpho: 550 });

  const gateway = await (await ethers.getContractFactory("EthGateway")).deploy(weth.target, wethStack.vault);

  // demo balances for the deployer
  await (await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6))).wait();
  await (await wsol.mint(deployer.address, ethers.parseUnits("100000", 9))).wait();
  await (await weth.fundETH({ value: ethers.parseEther("1") })).wait(); // back mock WETH yield

  const deployments = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    treasury,
    performanceFeeBps: FEE_BPS,
    tokens: { USDC: usdc.target, WETH: weth.target, WSOL: wsol.target },
    ethGateway: gateway.target,
    vaults: { USDC: usdcStack, WETH: wethStack, WSOL: wsolStack },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(deployments, null, 2));
  console.log(JSON.stringify(deployments, null, 2));
  console.log(`\nSaved to deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
