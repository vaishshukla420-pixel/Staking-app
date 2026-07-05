const { ethers } = require("hardhat");

const USDC = (n) => ethers.parseUnits(n.toString(), 6);
const ETH = (n) => ethers.parseEther(n.toString());
const YEAR = 365 * 24 * 3600;

/**
 * Full protocol on a mock USDC: one vault + Aave/Compound/Morpho mock venues,
 * one strategy adapter each, 20% performance fee, 100M USDC cap.
 */
async function deployProtocolFixture() {
  const [deployer, treasury, alice, bob, keeper, reporter] = await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);

  const vault = await (
    await ethers.getContractFactory("YieldVault")
  ).deploy(usdc.target, "Yield USDC", "yUSDC", treasury.address, 2000, USDC(100_000_000));

  const aavePool = await (await ethers.getContractFactory("MockAaveV3Pool")).deploy(usdc.target);
  const aaveStrategy = await (
    await ethers.getContractFactory("AaveV3Strategy")
  ).deploy(vault.target, usdc.target, aavePool.target, aavePool.target);

  const comet = await (await ethers.getContractFactory("MockComet")).deploy(usdc.target);
  const compoundStrategy = await (
    await ethers.getContractFactory("CompoundV3Strategy")
  ).deploy(vault.target, usdc.target, comet.target);

  const metaMorpho = await (await ethers.getContractFactory("MockMetaMorpho")).deploy(usdc.target);
  const morphoStrategy = await (
    await ethers.getContractFactory("MorphoStrategy")
  ).deploy(vault.target, usdc.target, metaMorpho.target, reporter.address);

  await vault.addStrategy(aaveStrategy.target);
  await vault.addStrategy(compoundStrategy.target);
  await vault.addStrategy(morphoStrategy.target);
  await vault.setKeeper(keeper.address, true);

  for (const user of [alice, bob]) {
    await usdc.mint(user.address, USDC(1_000_000));
    await usdc.connect(user).approve(vault.target, ethers.MaxUint256);
  }

  return {
    deployer, treasury, alice, bob, keeper, reporter,
    usdc, vault, aavePool, aaveStrategy, comet, compoundStrategy, metaMorpho, morphoStrategy,
  };
}

module.exports = { deployProtocolFixture, USDC, ETH, YEAR };
