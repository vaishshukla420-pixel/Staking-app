const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");
const { deployProtocolFixture, USDC, YEAR } = require("./fixtures");

describe("YieldVault — deposits, withdrawals, yield accounting", () => {
  it("accepts deposits and redeems 1:1 while no yield has accrued", async () => {
    const { vault, usdc, alice } = await loadFixture(deployProtocolFixture);

    await vault.connect(alice).deposit(USDC(1000), alice.address);
    expect(await vault.convertToAssets(await vault.balanceOf(alice.address))).to.equal(USDC(1000));
    expect(await vault.totalAssets()).to.equal(USDC(1000));

    const before = await usdc.balanceOf(alice.address);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(USDC(1000));
  });

  it("pushes deposits into the active strategy and pulls back on withdrawal", async () => {
    const { vault, usdc, alice, keeper, aaveStrategy, aavePool } = await loadFixture(deployProtocolFixture);

    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(5000), alice.address);

    // funds live at the venue, not idle in the vault
    expect(await usdc.balanceOf(vault.target)).to.equal(0);
    expect(await aavePool.balanceOf(aaveStrategy.target)).to.equal(USDC(5000));

    await vault.connect(alice).withdraw(USDC(2000), alice.address, alice.address);
    expect(await aavePool.balanceOf(aaveStrategy.target)).to.equal(USDC(3000));
  });

  it("grows the share price with venue yield — depositors earn on withdrawal", async () => {
    const { vault, usdc, alice, keeper, aaveStrategy, aavePool } = await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(500); // 5%
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(100_000), alice.address);

    await time.increase(YEAR);

    // ~5% linear yield
    expect(await vault.totalAssets()).to.be.closeTo(USDC(105_000), USDC(10));

    const before = await usdc.balanceOf(alice.address);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    const received = (await usdc.balanceOf(alice.address)) - before;
    expect(received).to.be.closeTo(USDC(105_000), USDC(10));
  });

  it("allocates yield across users proportionally to time in the pool", async () => {
    const { vault, usdc, alice, bob, keeper, aaveStrategy, aavePool } = await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(1000); // 10%
    await vault.connect(keeper).rebalance(aaveStrategy.target);

    await vault.connect(alice).deposit(USDC(10_000), alice.address);
    await time.increase(YEAR); // alice alone earns ~1000

    await vault.connect(bob).deposit(USDC(10_000), bob.address);
    const bobShares = await vault.balanceOf(bob.address);
    expect(bobShares).to.be.lt(await vault.balanceOf(alice.address)); // share price already rose

    await time.increase(YEAR); // pot now ~21000 earning 10% -> each side grows ~equally in %

    const aliceAssets = await vault.convertToAssets(await vault.balanceOf(alice.address));
    const bobAssets = await vault.convertToAssets(bobShares);
    // alice: ~10000 *1.1 (year 1) then + share of year-2 interest on 11000 principal-equivalent
    expect(aliceAssets).to.be.gt(bobAssets);
    expect(bobAssets).to.be.closeTo(USDC(11_000), USDC(60)); // bob: ~10% on his 10k
    // nothing lost or invented
    const total = await vault.totalAssets();
    expect(aliceAssets + bobAssets).to.be.closeTo(total, USDC(1));
  });

  it("enforces the deposit cap", async () => {
    const { vault, alice, deployer } = await loadFixture(deployProtocolFixture);

    await vault.connect(deployer).setDepositCap(USDC(1500));
    expect(await vault.maxDeposit(alice.address)).to.equal(USDC(1500));

    await vault.connect(alice).deposit(USDC(1000), alice.address);
    expect(await vault.maxDeposit(alice.address)).to.equal(USDC(500));

    await expect(vault.connect(alice).deposit(USDC(501), alice.address))
      .to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxDeposit");
  });

  it("blocks deposits while paused but never blocks withdrawals", async () => {
    const { vault, alice, keeper, deployer } = await loadFixture(deployProtocolFixture);

    await vault.connect(alice).deposit(USDC(1000), alice.address);
    await vault.connect(keeper).pause();

    await expect(vault.connect(alice).deposit(USDC(1), alice.address)).to.be.reverted;
    await expect(vault.connect(alice).withdraw(USDC(500), alice.address, alice.address)).to.not.be.reverted;

    await vault.connect(deployer).unpause();
    await expect(vault.connect(alice).deposit(USDC(1), alice.address)).to.not.be.reverted;
  });

  it("makes first-depositor share-inflation attacks unprofitable", async () => {
    const { vault, usdc, alice, bob } = await loadFixture(deployProtocolFixture);

    // attacker: dust deposit + big donation to skew the share price
    await vault.connect(bob).deposit(1n, bob.address);
    await usdc.connect(bob).transfer(vault.target, USDC(10_000));

    // victim deposits; must not be wiped out by rounding
    await vault.connect(alice).deposit(USDC(1000), alice.address);
    const aliceAssets = await vault.convertToAssets(await vault.balanceOf(alice.address));
    expect(aliceAssets).to.be.gte(USDC(999)); // loss bounded to dust

    // attacker cannot profit: gets back at most (donation + dust) minus rounding
    const bobAssets = await vault.convertToAssets(await vault.balanceOf(bob.address));
    expect(bobAssets).to.be.lte(USDC(10_000) + 1n);
  });

  it("reports net APR data for the frontend", async () => {
    const { vault, keeper, aaveStrategy, aavePool } = await loadFixture(deployProtocolFixture);
    expect(await vault.currentAPRBps()).to.equal(0); // idle
    await aavePool.setAPRBps(700);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    expect(await vault.currentAPRBps()).to.equal(700);
    expect(await vault.performanceFeeBps()).to.equal(2000);
  });
});
