import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { ethers as ethersv6 } from "ethers";

import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
describe("Vault", () => {
  let vault: Vault;
  let usdc: ERC20Mintable;
  let provider = hre.ethers.provider;
  let governance: HardhatEthersSigner;
  let alice: ethersv6.Wallet;
  let bob: ethersv6.Wallet;
  let amount = 10n ** 6n;
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;

  before(async () => {
    await hre.deployments.fixture();
    let { deployer } = await getNamedAccounts();
    governance = await hre.ethers.getSigner(deployer);
    const { get } = hre.deployments;
    usdc = ERC20Mintable__factory.connect((await get("USDC")).address, provider);
    vault = Vault__factory.connect((await get("Vault")).address, governance);
    strategy = MockStrategy__factory.connect((await get("MockStrategy")).address, governance);

    alice = new ethersv6.Wallet(ethersv6.Wallet.createRandom().privateKey, provider);
    bob = new ethersv6.Wallet(ethersv6.Wallet.createRandom().privateKey, provider);

    await governance.sendTransaction({
      to: alice.address,
      value: ethersv6.parseEther("100"),
    });
    await governance.sendTransaction({
      to: bob.address,
      value: ethersv6.parseEther("100"),
    });
    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
  });

  it("add strategy with valid strategy", async () => {
    await expect(vault.connect(governance).addStrategy(await strategy.getAddress(), true))
      .to.be.emit(vault, "StrategyChanged")
      .withArgs(await strategy.getAddress(), 0n);
    let snapshot = await provider.getBlock(await provider.getBlockNumber());
    let strategyData = await vault.strategies(await strategy.getAddress());
    expect(strategyData.activation).to.be.approximately(snapshot?.timestamp, 0);
    expect(strategyData.lastReport).to.be.approximately(snapshot?.timestamp, 0);
    expect(strategyData.currentDebt).to.be.equal(0);
    expect(strategyData.maxDebt).to.be.equal(0);
  });

  it("add strategy with zero address", async () => {
    await expect(vault.connect(governance).addStrategy(ethersv6.ZeroAddress, true)).to.be.reverted;
  });

  it("add strategy with activation failds", async () => {
    await vault.connect(governance).addStrategy(await strategy.getAddress(), true);
    await expect(vault.connect(governance).addStrategy(await strategy.getAddress(), true)).to.be.revertedWith("Strategy already active");
  });

  it("revoke strategy with existing failds", async () => {
    await vault.connect(governance).addStrategy(await strategy.getAddress(), true);
    await expect(vault.connect(governance).revokeStrategy(await strategy.getAddress()))
      .to.be.emit(vault, "StrategyChanged")
      .withArgs(await strategy.getAddress(), 1n);
  });

  it("revoke strategy with inactive failds", async () => {
    await expect(vault.connect(governance).revokeStrategy(await strategy.getAddress())).to.be.revertedWith("Strategy not active");
  });
});
