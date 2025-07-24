import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Accountant, Accountant__factory, ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts, network } from "hardhat";
import hre from "hardhat";
import { assert, ethers as ethersv6, parseUnits } from "ethers";
import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import {
  mintAndDeposit,
  setDepositLimit,
  setDepositLimitModule,
  setLoss,
  setLock,
  setMaxDebt,
  setMinimumTotalIdle,
  airdropAsset,
  getVaultBalance,
  getStrategyBalance,
  addStrategy,
  addDebtToStrategy,
  processReport,
} from "../helper";

describe("Vault debt_management Tests", () => {
  let vault: Vault;
  let usdc: ERC20Mintable;
  let provider = hre.ethers.provider;
  let governance: HardhatEthersSigner;
  let alice: ethersv6.Wallet;
  let bob: ethersv6.Wallet;
  let amount = parseUnits("10000", 6);
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;
  let accountant: Accountant;

  before(async () => {
    await hre.deployments.fixture();
    let { deployer } = await getNamedAccounts();
    governance = await hre.ethers.getSigner(deployer);
    const { get } = hre.deployments;
    usdc = ERC20Mintable__factory.connect((await get("USDC")).address, provider);
    vault = Vault__factory.connect((await get("Vault")).address, governance);
    strategy = MockStrategy__factory.connect((await get("MockStrategy")).address, governance);
    accountant = Accountant__factory.connect((await get("Accountant")).address, governance);
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

  async function initialSetup(debtAmount: bigint = amount / 10n) {
    await mintAndDeposit(vault, usdc, amount / 10n, alice);
    await addStrategy(vault, strategy, governance);
    await addDebtToStrategy(vault, strategy, debtAmount, governance);
  }
  describe("Debt Management", () => {
      it("updateMaxDebt: should update max debt for a strategy", async () => {
    await mintAndDeposit(vault, usdc, amount, alice);
    await addStrategy(vault, strategy, governance);

    const newMaxDebt = amount;
    // await setMaxDebt(vault, strategy, newMaxDebt, governance);
    await vault
    .connect(governance)
    .updateMaxDebtForStrategy(await strategy.getAddress(), newMaxDebt);
    const info = await vault.strategies(await strategy.getAddress());
      expect(info.maxDebt).to.equal(newMaxDebt);
  });
  it("updateMaxDebt: update max debt with inactive strategy should revert", async () => {
    const newStrategy = MockStrategy__factory.connect((await hre.deployments.get("MockStrategy")).address, governance);
    // await addStrategy(vault, strategy, governance);
    const maxDebt = parseUnits("1000", 6);
    await expect(
    vault.connect(governance).updateMaxDebtForStrategy(await newStrategy.getAddress(), maxDebt)
  ).to.be.revertedWith("Inactive strategy");
  });
//   it("updateDebt: ")
});
});