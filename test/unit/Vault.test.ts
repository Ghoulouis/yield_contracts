import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { ethers, getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { ethers as ethersv6, MaxUint256, parseUnits } from "ethers";
import { addDebtToStrategy, addStrategy, mintAndDeposit, setDepositLimit, setDepositLimitModule, setLock, setLoss, updateDebt } from "../helper";
import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
describe("ERC 4626", () => {
  let vault: Vault;
  let usdc: ERC20Mintable;
  let provider = hre.ethers.provider;
  let governance: HardhatEthersSigner;
  let alice: ethersv6.Wallet;
  let bob: ethersv6.Wallet;
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;

  before(async () => {
    await hre.deployments.fixture();
    let { deployer, agent, beneficiary } = await getNamedAccounts();
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

  let amount = parseUnits("1000", 6);

  describe("Update debt", () => {
    let amount = parseUnits("1000", 6);
    let maxDebt = parseUnits("10000000", 6);
    beforeEach(async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      await addStrategy(vault, strategy, governance);
      await vault.connect(governance).updateMaxDebtForStrategy(await strategy.getAddress(), maxDebt);
    });

    it("update debt when target debt > current debt  && target debt < max debt should success ", async () => {
      let amountDebt = amount / 2n;
      let preVaultData = await vault.strategies(await strategy.getAddress());
      await expect(vault.connect(governance).updateDebt(await strategy.getAddress(), amountDebt, 0))
        .to.be.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), 0, amountDebt);
      let postStrategyData = await vault.strategies(await strategy.getAddress());
      expect(postStrategyData.currentDebt).to.be.equal(amountDebt);
    });
  });

  xdescribe("test withdraw", () => {
    let amount = parseUnits("1000", 6);

    beforeEach(async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      await addStrategy(vault, strategy, governance);
    });

    it("withdraw() when requestAssets <= currentTotalIdle", async () => {
      let debtAmount = amount / 2n;
      let amountWithdraw = amount / 4n;
      await addDebtToStrategy(vault, strategy, debtAmount, governance);
      let totalIdle = await vault.totalIdle();
      expect(totalIdle).to.be.equal(amount / 2n);

      await expect(vault.connect(alice).withdraw(amountWithdraw, alice.address, alice.address))
        .to.be.emit(vault, "Withdrawn")
        .withArgs(alice.address, amount / 4n, amount / 4n, 0);
    });

    it("withdraw when requestAsset() > currentTotalIdle", async () => {
      let debtAmount = amount / 2n;
      let amountWithdraw = (amount * 3n) / 4n;
      await addDebtToStrategy(vault, strategy, debtAmount, governance);
      let totalIdle = await vault.totalIdle();
      expect(totalIdle).to.be.equal(amount / 2n);
      await expect(vault.connect(alice).withdraw(amountWithdraw, alice.address, alice.address))
        .to.be.emit(vault, "Withdrawn")
        .withArgs(alice.address, amountWithdraw, amountWithdraw, 0);
    });

    it("withdraw more than balance should revert", async () => {
      let amountWithdraw = (amount * 5n) / 4n;
      await expect(vault.connect(alice).withdraw(amountWithdraw, alice.address, alice.address)).to.be.revertedWith("Insufficient shares");
    });

    it("withdraw 0 more than balance should revert", async () => {
      let amountWithdraw = 0n;
      await expect(vault.connect(alice).withdraw(amountWithdraw, alice.address, alice.address)).to.be.revertedWith("No shares to redeem");
    });

    it("withdraw when loss", async () => {
      let debtAmount = amount / 2n;
      let loss = amount / 4n;
      await updateDebt(vault, strategy, debtAmount, governance);

      //await setLoss(strategy, loss, governance);
    });
  });
});
