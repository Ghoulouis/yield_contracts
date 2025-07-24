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
  parseStrategyReportedEvent,
  setFee,
} from "../helper";

describe("Vault Additional Tests", () => {
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

  describe("processReport", () => {
    it("reverts if strategy address is zero", async () => {
      await expect(vault.connect(governance).processReport(ethersv6.ZeroAddress)).to.be.revertedWith("Inactive strategy");
    });

    it("reverts if strategy is not active", async () => {
      const randomAddress = ethersv6.Wallet.createRandom().address;
      await expect(vault.connect(governance).processReport(randomAddress)).to.be.revertedWith("Inactive strategy");
    });

    it("handles gain with no fees or refunds", async () => {
      await initialSetup();
      const profit = amount / 20n;
      await usdc.connect(governance).mint(await strategy.getAddress(), profit);
      await strategy.connect(governance).harvest();

      const initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      const initialTotalDebt = await vault.totalDebt();
      const tx = await vault.connect(governance).processReport(await strategy.getAddress());
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return vault.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "StrategyReported");

      expect(event?.args.strategy).to.equal(await strategy.getAddress());
      expect(event?.args.gain).to.equal(profit);
      expect(event?.args.loss).to.equal(0);
      expect(event?.args.currentDebt).to.equal(initialDebt + profit);
      expect(event?.args.protocolFees).to.equal(0);
      expect(event?.args.totalFees).to.equal(0);
      expect(event?.args.totalRefunds).to.equal(0);
      expect(await vault.totalDebt()).to.equal(initialTotalDebt + profit);
      expect(await getStrategyBalance(strategy, usdc)).to.equal(initialDebt + profit);
    });

    it("handles zero gain and loss", async () => {
      await initialSetup();
      const initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      const initialTotalDebt = await vault.totalDebt();
      const tx = await vault.connect(governance).processReport(await strategy.getAddress());
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return vault.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "StrategyReported");

      expect(event?.args.gain).to.equal(0);
      expect(event?.args.loss).to.equal(0);
      expect(event?.args.currentDebt).to.equal(initialDebt);
      expect(event?.args.totalFees).to.equal(0);
      expect(event?.args.totalRefunds).to.equal(0);
      expect(await vault.totalDebt()).to.equal(initialTotalDebt);
    });

    it("reverts if strategy is not active", async () => {
      const randomAddress = ethersv6.Wallet.createRandom().address;
      await expect(vault.connect(governance).processReport(randomAddress)).to.be.revertedWith("Inactive strategy");
    });

    it("handles gain with no fees or refunds", async () => {
      await initialSetup();
      const profit = amount / 20n;
      await usdc.connect(governance).mint(await strategy.getAddress(), profit);
      await strategy.connect(governance).harvest();

      const initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      const initialTotalDebt = await vault.totalDebt();
      const tx = await vault.connect(governance).processReport(await strategy.getAddress());
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return vault.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "StrategyReported");

      expect(event?.args.strategy).to.equal(await strategy.getAddress());
      expect(event?.args.gain).to.equal(profit);
      expect(event?.args.loss).to.equal(0);
      expect(event?.args.currentDebt).to.equal(initialDebt + profit);
      expect(event?.args.protocolFees).to.equal(0);
      expect(event?.args.totalFees).to.equal(0);
      expect(event?.args.totalRefunds).to.equal(0);
      expect(await vault.totalDebt()).to.equal(initialTotalDebt + profit);
      expect(await getStrategyBalance(strategy, usdc)).to.equal(initialDebt + profit);
    });

    it("handles zero gain and loss", async () => {
      await initialSetup();
      const initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      const initialTotalDebt = await vault.totalDebt();
      const tx = await vault.connect(governance).processReport(await strategy.getAddress());
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return vault.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "StrategyReported");

      expect(event?.args.gain).to.equal(0);
      expect(event?.args.loss).to.equal(0);
      expect(event?.args.currentDebt).to.equal(initialDebt);
      expect(event?.args.totalFees).to.equal(0);
      expect(event?.args.totalRefunds).to.equal(0);
      expect(await vault.totalDebt()).to.equal(initialTotalDebt);
    });
  });

  describe("Airdrop and Balance Checks", () => {
    it("should airdrop assets to address", async () => {
      const airdropAmount = amount / 10n;
      await airdropAsset(usdc, bob.address, airdropAmount, governance);
      expect(await usdc.balanceOf(bob.address)).to.equal(airdropAmount);
    });

    it("should correctly get vault and strategy balances", async () => {
      await initialSetup();
      expect(await getVaultBalance(vault, usdc)).to.equal(0n); // After debt allocation
      expect(await getStrategyBalance(strategy, usdc)).to.equal(amount / 10n);

      await usdc.connect(governance).mint(await strategy.getAddress(), amount / 20n);
      await processReport(vault, strategy, governance);
      expect(await getStrategyBalance(strategy, usdc)).to.equal(amount / 10n + amount / 20n);
    });
  });
});
