const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");
const { ETH, YEAR } = require("./fixtures");

async function deployEthVaultFixture() {
  const [deployer, treasury, alice, keeper] = await ethers.getSigners();

  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
  const vault = await (
    await ethers.getContractFactory("YieldVault")
  ).deploy(weth.target, "Yield ETH", "yETH", treasury.address, 2000, ETH(1_000_000));

  const aavePool = await (await ethers.getContractFactory("MockAaveV3Pool")).deploy(weth.target);
  const aaveStrategy = await (
    await ethers.getContractFactory("AaveV3Strategy")
  ).deploy(vault.target, weth.target, aavePool.target, aavePool.target);
  await vault.addStrategy(aaveStrategy.target);
  await vault.setKeeper(keeper.address, true);

  const gateway = await (await ethers.getContractFactory("EthGateway")).deploy(weth.target, vault.target);

  // back future mock-minted WETH yield with real ETH so unwrapping works
  await weth.connect(deployer).fundETH({ value: ETH(100) });

  return { deployer, treasury, alice, keeper, weth, vault, aavePool, aaveStrategy, gateway };
}

describe("EthGateway — native ETH in and out of the WETH vault", () => {
  it("deposits plain ETH and earns yield like any other depositor", async () => {
    const { vault, alice, keeper, aavePool, aaveStrategy, gateway } =
      await loadFixture(deployEthVaultFixture);

    await aavePool.setAPRBps(500);
    await vault.connect(keeper).rebalance(aaveStrategy.target);

    await gateway.connect(alice).depositETH(alice.address, { value: ETH(10) });
    expect(await vault.convertToAssets(await vault.balanceOf(alice.address))).to.be.closeTo(ETH(10), 10n ** 12n);

    await time.increase(YEAR);
    expect(await vault.convertToAssets(await vault.balanceOf(alice.address)))
      .to.be.closeTo(ETH(10.5), ETH(0.01)); // ~5%
  });

  it("withdraws back to native ETH (shares approved to the gateway)", async () => {
    const { vault, alice, keeper, aavePool, aaveStrategy, gateway } =
      await loadFixture(deployEthVaultFixture);

    await aavePool.setAPRBps(500);
    await vault.connect(keeper).rebalance(aaveStrategy.target);
    await gateway.connect(alice).depositETH(alice.address, { value: ETH(10) });
    await time.increase(YEAR);

    await vault.connect(alice).approve(gateway.target, ethers.MaxUint256);
    const before = await ethers.provider.getBalance(alice.address);
    await gateway.connect(alice).redeemETH(await vault.balanceOf(alice.address), alice.address);
    const received = (await ethers.provider.getBalance(alice.address)) - before;

    expect(received).to.be.closeTo(ETH(10.5), ETH(0.01)); // principal + yield, minus gas dust
  });

  it("rejects zero amounts, stray ETH, and unapproved withdrawals", async () => {
    const { alice, gateway, weth } = await loadFixture(deployEthVaultFixture);

    await expect(gateway.connect(alice).depositETH(alice.address, { value: 0 }))
      .to.be.revertedWithCustomError(gateway, "ZeroAmount");
    await expect(alice.sendTransaction({ to: gateway.target, value: ETH(1) }))
      .to.be.revertedWithCustomError(gateway, "NotWETH");

    await gateway.connect(alice).depositETH(alice.address, { value: ETH(1) });
    // no share approval to the gateway -> vault must refuse
    await expect(gateway.connect(alice).withdrawETH(ETH(0.5), alice.address)).to.be.reverted;
    expect(await weth.balanceOf(gateway.target)).to.equal(0); // gateway never strands funds
  });
});
