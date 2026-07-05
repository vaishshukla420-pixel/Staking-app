const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");
const { deployProtocolFixture, USDC, YEAR } = require("./fixtures");

describe("YieldVault — auto-rebalancing across Aave / Compound / Morpho", () => {
  it("reads live APRs from every venue and identifies the best one", async () => {
    const { vault, reporter, aavePool, comet, morphoStrategy, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(300);
    await comet.setAPRBps(450);
    await morphoStrategy.connect(reporter).reportAPR(200);

    const [best, bestApr] = await vault.bestStrategy();
    expect(best).to.equal(compoundStrategy.target);
    expect(bestApr).to.be.closeTo(450n, 1n); // Comet per-second rate round-trips within 1 bps
  });

  it("keeper can rebalance and all funds move to the new venue", async () => {
    const { vault, alice, keeper, aaveStrategy, aavePool, comet, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(50_000), alice.address);
    expect(await aavePool.balanceOf(aaveStrategy.target)).to.equal(USDC(50_000));

    const totalBefore = await vault.totalAssets();
    await vault.connect(keeper).rebalance(compoundStrategy.target);

    expect(await aavePool.balanceOf(aaveStrategy.target)).to.equal(0);
    expect(await comet.balanceOf(compoundStrategy.target)).to.equal(USDC(50_000));
    expect(await vault.totalAssets()).to.be.closeTo(totalBefore, USDC(1)); // nothing lost in transit
    expect(await vault.activeStrategy()).to.equal(compoundStrategy.target);
  });

  it("lets ANYONE rebalance when the APR improvement clears the threshold", async () => {
    const { vault, alice, bob, keeper, aaveStrategy, aavePool, comet, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(300);
    await comet.setAPRBps(500); // +200 bps > 50 bps threshold
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(10_000), alice.address);

    await time.increase(6 * 3600 + 1); // cooldown

    await expect(vault.connect(bob).rebalance(compoundStrategy.target))
      .to.emit(vault, "Rebalanced");
    expect(await vault.activeStrategy()).to.equal(compoundStrategy.target);
  });

  it("rejects permissionless rebalances that don't clear the improvement threshold", async () => {
    const { vault, bob, keeper, aaveStrategy, aavePool, comet, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(300);
    await comet.setAPRBps(320); // +20 bps < 50 bps threshold
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await time.increase(6 * 3600 + 1);

    await expect(vault.connect(bob).rebalance(compoundStrategy.target))
      .to.be.revertedWithCustomError(vault, "ImprovementTooSmall");
  });

  it("enforces the cooldown for permissionless rebalances (keeper is exempt)", async () => {
    const { vault, bob, keeper, aaveStrategy, aavePool, comet, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(300);
    await comet.setAPRBps(600);
    await vault.connect(keeper).rebalance(aaveStrategy.target); // starts cooldown

    await expect(vault.connect(bob).rebalance(compoundStrategy.target))
      .to.be.revertedWithCustomError(vault, "CooldownActive");

    // keeper can still move immediately (e.g. venue risk event)
    await expect(vault.connect(keeper).rebalance(compoundStrategy.target)).to.not.be.reverted;
  });

  it("moves into Morpho on reported APR and treats stale reports as 0", async () => {
    const { vault, alice, keeper, reporter, metaMorpho, morphoStrategy } =
      await loadFixture(deployProtocolFixture);

    await morphoStrategy.connect(reporter).reportAPR(800);
    await metaMorpho.setAPRBps(800);
    await vault.connect(keeper).rebalance(morphoStrategy.target);
    await vault.connect(alice).deposit(USDC(20_000), alice.address);

    expect(await morphoStrategy.totalAssets()).to.be.closeTo(USDC(20_000), USDC(1));
    expect(await vault.currentAPRBps()).to.equal(800);

    await time.increase(2 * 24 * 3600); // past 1-day staleness window
    expect(await morphoStrategy.currentAPRBps()).to.equal(0);
  });

  it("carries accrued yield along when rebalancing", async () => {
    const { vault, alice, keeper, aaveStrategy, aavePool, compoundStrategy, comet } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(1000);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(10_000), alice.address);
    await time.increase(YEAR); // ~1000 profit at Aave

    await vault.connect(keeper).rebalance(compoundStrategy.target);
    // principal + yield (minus 20% performance fee on the 1000 profit, harvested during rebalance)
    expect(await comet.balanceOf(compoundStrategy.target)).to.be.closeTo(USDC(11_000), USDC(5));
    expect(await vault.totalAssets()).to.be.closeTo(USDC(11_000), USDC(5));
  });

  it("validates strategies on add/remove", async () => {
    const { vault, deployer, keeper, usdc, aaveStrategy, aavePool, compoundStrategy } =
      await loadFixture(deployProtocolFixture);

    // wrong-asset strategy is rejected
    const otherToken = await (await ethers.getContractFactory("MockERC20")).deploy("Other", "OTH", 18);
    const otherPool = await (await ethers.getContractFactory("MockAaveV3Pool")).deploy(otherToken.target);
    const badStrategy = await (
      await ethers.getContractFactory("AaveV3Strategy")
    ).deploy(vault.target, otherToken.target, otherPool.target, otherPool.target);
    await expect(vault.connect(deployer).addStrategy(badStrategy.target))
      .to.be.revertedWithCustomError(vault, "StrategyAssetMismatch");

    // unknown strategy can't receive funds
    const foreignVault = await (
      await ethers.getContractFactory("YieldVault")
    ).deploy(usdc.target, "x", "x", deployer.address, 0, USDC(1));
    const foreignStrategy = await (
      await ethers.getContractFactory("AaveV3Strategy")
    ).deploy(foreignVault.target, usdc.target, aavePool.target, aavePool.target);
    await expect(vault.connect(keeper).rebalance(foreignStrategy.target))
      .to.be.revertedWithCustomError(vault, "UnknownStrategy");

    // active strategy can't be removed; inactive can
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await expect(vault.connect(deployer).removeStrategy(aaveStrategy.target))
      .to.be.revertedWithCustomError(vault, "StrategyInUse");
    await expect(vault.connect(deployer).removeStrategy(compoundStrategy.target)).to.not.be.reverted;

    // strategies only accept calls from their vault
    await expect(aaveStrategy.connect(keeper).withdraw(1, keeper.address))
      .to.be.revertedWithCustomError(aaveStrategy, "OnlyVault");
  });
});
