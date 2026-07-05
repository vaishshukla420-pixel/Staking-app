const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployProtocolFixture, USDC, YEAR } = require("./fixtures");

describe("YieldVault — performance fee (the protocol spread)", () => {
  it("mints the treasury shares worth feeBps of harvested profit", async () => {
    const { vault, treasury, alice, keeper, aaveStrategy, aavePool } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(1000); // 10%
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(100_000), alice.address);

    await time.increase(YEAR); // ~10,000 profit
    await vault.harvest();

    const treasuryAssets = await vault.convertToAssets(await vault.balanceOf(treasury.address));
    expect(treasuryAssets).to.be.closeTo(USDC(2_000), USDC(5)); // 20% of profit

    const aliceAssets = await vault.convertToAssets(await vault.balanceOf(alice.address));
    expect(aliceAssets).to.be.closeTo(USDC(108_000), USDC(5)); // principal + 80% of profit
  });

  it("charges nothing when there is no profit", async () => {
    const { vault, treasury, alice } = await loadFixture(deployProtocolFixture);

    await vault.connect(alice).deposit(USDC(50_000), alice.address);
    await vault.harvest();
    await vault.harvest(); // double-harvest must not double-charge either
    expect(await vault.balanceOf(treasury.address)).to.equal(0);
  });

  it("does not mistake deposits or withdrawals for profit", async () => {
    const { vault, treasury, alice, bob } = await loadFixture(deployProtocolFixture);

    await vault.connect(alice).deposit(USDC(10_000), alice.address);
    await vault.connect(bob).deposit(USDC(25_000), bob.address);
    await vault.connect(alice).withdraw(USDC(4_000), alice.address, alice.address);
    await vault.harvest();

    expect(await vault.balanceOf(treasury.address)).to.equal(0);
  });

  it("only charges each unit of profit once across consecutive harvests", async () => {
    const { vault, treasury, alice, keeper, aaveStrategy, aavePool } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(1000);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(100_000), alice.address);

    await time.increase(YEAR / 2);
    await vault.harvest();
    await time.increase(YEAR / 2);
    await vault.harvest();

    // ≈ one full-year fee, slightly more because the treasury's own fee
    // shares from the first harvest keep earning yield in the second half —
    // but never less (no double-charging of the same profit)
    const treasuryAssets = await vault.convertToAssets(await vault.balanceOf(treasury.address));
    expect(treasuryAssets).to.be.gte(USDC(2_000));
    expect(treasuryAssets).to.be.lte(USDC(2_100));
  });

  it("caps the fee and harvests at the old rate before a fee change", async () => {
    const { vault, deployer, treasury, alice, keeper, aaveStrategy, aavePool } =
      await loadFixture(deployProtocolFixture);

    await expect(vault.connect(deployer).setPerformanceFeeBps(3001))
      .to.be.revertedWithCustomError(vault, "FeeTooHigh");

    await aavePool.setAPRBps(1000);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(100_000), alice.address);
    await time.increase(YEAR);

    await vault.connect(deployer).setPerformanceFeeBps(0); // harvests pending profit at 20% first
    const treasuryAssets = await vault.convertToAssets(await vault.balanceOf(treasury.address));
    expect(treasuryAssets).to.be.closeTo(USDC(2_000), USDC(5));
  });

  it("emergencyWithdraw recalls all funds, pauses deposits, users can still exit", async () => {
    const { vault, usdc, alice, keeper, aaveStrategy, aavePool } =
      await loadFixture(deployProtocolFixture);

    await aavePool.setAPRBps(500);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await vault.connect(alice).deposit(USDC(30_000), alice.address);

    await vault.connect(keeper).emergencyWithdraw();

    expect(await vault.activeStrategy()).to.equal("0x0000000000000000000000000000000000000000");
    expect(await usdc.balanceOf(vault.target)).to.be.gte(USDC(30_000));
    expect(await vault.paused()).to.equal(true);

    await expect(vault.connect(alice).deposit(USDC(1), alice.address)).to.be.reverted;
    const before = await usdc.balanceOf(alice.address);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    expect((await usdc.balanceOf(alice.address)) - before).to.be.gte(USDC(30_000));
  });

  it("only owner can touch fee/treasury/keeper/cap settings", async () => {
    const { vault, alice } = await loadFixture(deployProtocolFixture);
    await expect(vault.connect(alice).setPerformanceFeeBps(0)).to.be.reverted;
    await expect(vault.connect(alice).setTreasury(alice.address)).to.be.reverted;
    await expect(vault.connect(alice).setKeeper(alice.address, true)).to.be.reverted;
    await expect(vault.connect(alice).setDepositCap(0)).to.be.reverted;
    await expect(vault.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(vault, "NotKeeperOrOwner");
  });
});
