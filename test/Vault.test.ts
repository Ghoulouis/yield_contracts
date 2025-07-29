import { DepositLimitModule } from "./../typechain-types/contracts/modules/DepositLimitModule";
import { red } from "@colors/colors";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  Accountant,
  Accountant__factory,
  DepositLimitModule__factory,
  ERC20Mintable,
  ERC20Mintable__factory,
  MockStrategy,
  MockStrategy__factory,
  Vault,
  Vault__factory,
  WithdrawLimitModule,
  WithdrawLimitModule__factory,
} from "../typechain-types";
import { ethers, getNamedAccounts, network } from "hardhat";
import hre from "hardhat";
import { ethers as ethersv6, MaxUint256, parseUnits } from "ethers";
import {
  addDebtToStrategy,
  addLossToStrategy,
  addProfitToStrategy,
  addStrategy,
  mintAndDeposit,
  setDepositLimit,
  setDepositLimitModule,
  setLock,
  setLoss,
  updateDebt,
  updateMaxDebt,
} from "./helper";
import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
describe("Vault", () => {
  let vault: Vault;
  let usdc: ERC20Mintable;
  let provider = hre.ethers.provider;
  let governance: HardhatEthersSigner;
  let alice: ethersv6.Wallet;
  let bob: ethersv6.Wallet;
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;
  const { get } = hre.deployments;

  before(async () => {
    await hre.deployments.fixture();
    let { deployer, agent, beneficiary } = await getNamedAccounts();
    governance = await hre.ethers.getSigner(deployer);

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

  describe("test withdraw", () => {
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

  describe("Management Fee", () => {
    it(" update management fee", async () => {
      let newFee = 100;
      await vault.connect(governance).setManagementFee(newFee);
      let postFee = (await vault.vaultData()).managementFee;
      expect(postFee).to.be.equal(newFee);
    });
    it(" update management fee receipt", async () => {
      await vault.connect(governance).setFeeRecipient(bob.address);
      let postFeeRecipient = (await vault.vaultData()).feeRecipient;
      expect(postFeeRecipient).to.be.equal(bob);
    });
    it(" update management without permission should revert", async () => {
      let newFee = 100;
      await expect(vault.connect(bob).setManagementFee(newFee)).to.be.reverted;
    });
    it(" take management fee in a action afert amount time", async () => {
      let newFee = 100;
      await vault.connect(governance).setManagementFee(newFee);
      await vault.connect(governance).setFeeRecipient(bob.address);
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, amount, alice);
      await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 - 1]);
      await network.provider.send("evm_mine");
      await expect(vault.connect(alice).redeem(amount, alice.address, alice.address))
        .to.be.emit(vault, "ManagementFeeMinted")
        .withArgs(bob.address, amount / 100n);
    });
    it(" take management fee in a action update fee afert amount time", async () => {
      let newFee = 100;
      await vault.connect(governance).setManagementFee(newFee);
      await vault.connect(governance).setFeeRecipient(bob.address);
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, amount, alice);
      await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 - 1]);
      await network.provider.send("evm_mine");
      newFee = 200;
      await expect(vault.connect(governance).setManagementFee(newFee))
        .to.be.emit(vault, "ManagementFeeMinted")
        .withArgs(bob.address, amount / 100n);
    });

    describe(" ERC4626 with fee", () => {
      let newFee = 100;
      let amount = parseUnits("1000", 6);
      beforeEach(async () => {
        await mintAndDeposit(vault, usdc, amount, alice);
        await vault.connect(governance).setManagementFee(newFee);
        await vault.connect(governance).setFeeRecipient(bob.address);
        await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 - 1]);
        await network.provider.send("evm_mine");
      });

      it("totalSupply()", async () => {
        let expectTotalSupply = (amount * 101n) / 100n;
        expect(await vault.totalSupplyWithFee()).to.be.approximately(expectTotalSupply, 1n);
      });

      it(" previewDeposit()", async () => {
        let expectMint = await vault.previewDeposit(amount);
        expect(expectMint).to.be.approximately((amount * 101n) / 100n, 1n);
      });

      it(" previewMint() matching with withdraw", async () => {
        let shares = await vault.previewDeposit(amount);
        let expectAssets = await vault.previewMint(shares);
        expect(expectAssets).to.be.approximately(amount, 1n);
      });
      it(" previewWithdraw() matching with withdraw", async () => {
        let shares = await vault.previewWithdraw(amount / 2n);

        await expect(vault.connect(alice).withdraw(amount / 2n, alice.address, alice.address))
          .to.be.emit(vault, "Withdrawn")
          .withArgs(alice.address, shares, amount / 2n, 0);
      });
    });
  });

  describe("Performance Fee & Refund ", () => {
    let accountant: Accountant;
    let amount = parseUnits("1000", 6);
    beforeEach(async () => {
      accountant = Accountant__factory.connect((await get("Accountant")).address, provider);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);
      await updateMaxDebt(vault, strategy, amount * 2n, governance);
      await updateDebt(vault, strategy, amount, governance);
    });
    it(" set Accountant with permission should success", async () => {
      await expect(vault.connect(governance).setAccountant(await accountant.getAddress()))
        .to.be.emit(vault, "UpdateAccountant")
        .withArgs(await accountant.getAddress());
      let postAccountant = (await vault.vaultData()).accountant;
      expect(postAccountant).to.be.equal(await accountant.getAddress());
    });
    it(" set Accountant without permission should revert", async () => {
      await expect(vault.connect(alice).setAccountant(await accountant.getAddress())).to.be.reverted;
    });
    it(" update Accountant should success ", async () => {
      await vault.connect(governance).setAccountant(alice.address);
      await vault.connect(governance).setAccountant(await accountant.getAddress());
    }),
      describe(" after set Accountant", async () => {
        beforeEach(async () => {
          await vault.connect(governance).setAccountant(await accountant.getAddress());
          await accountant.connect(governance).setPerformanceFee(await strategy.getAddress(), 1000); // 10% ( Base pbs = 10_000)
          await accountant.connect(governance).setRefundRatio(await strategy.getAddress(), 10000); // 10% ( Base pbs = 10_000  )
        });
        it(" take performance Fee when report a profit strategy", async () => {
          let profit = amount / 10n;
          let fee = profit / 10n;
          await addProfitToStrategy(strategy, usdc, profit, governance);
          let preFeeBalance = await vault.convertToAssets(await vault.balanceOf(await accountant.getAddress()));
          await expect(vault.connect(governance).processReport(await strategy.getAddress()))
            .to.be.emit(vault, "StrategyReported")
            .withArgs(await strategy.getAddress(), profit, 0, amount + profit, fee, 0);
          let postFeeBalance = await vault.convertToAssets(await vault.balanceOf(await accountant.getAddress()));
          expect(postFeeBalance - preFeeBalance).to.equal(fee);
        });
        it("refund when report a loss strategy", async () => {
          await usdc.connect(governance).mint(await accountant.getAddress(), amount);
          let loss = amount / 10n;
          let refund = loss;
          await addLossToStrategy(strategy, usdc, loss, governance);
          await expect(vault.connect(governance).processReport(await strategy.getAddress()))
            .to.be.emit(vault, "StrategyReported")
            .withArgs(await strategy.getAddress(), 0, loss, amount - loss, 0, refund);
        });
      });
  });

  describe("LimitModule", () => {
    describe("LimitDepositModule", async () => {
      let limitDepositModule: DepositLimitModule;
      beforeEach(async () => {
        limitDepositModule = DepositLimitModule__factory.connect((await get("DepositLimitModule")).address, governance);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, amount, alice);
        await updateMaxDebt(vault, strategy, amount * 2n, governance);
        await updateDebt(vault, strategy, amount, governance);
      });
      it("set LimitDepositModule with permission should success", async () => {
        await expect(vault.connect(governance).setDepositLimitModule(await limitDepositModule.getAddress()))
          .to.be.emit(vault, "UpdateDepositLimitModule")
          .withArgs(await limitDepositModule.getAddress());
        let postLimitDepositModule = (await vault.vaultData()).depositLimitModule;
        expect(postLimitDepositModule).to.be.equal(await limitDepositModule.getAddress());
      });
      it("update LimitDepositModule with permission should success", async () => {
        await vault.connect(governance).setDepositLimitModule(alice.address);
        let preLimitDepositModule = (await vault.vaultData()).depositLimitModule;
        expect(preLimitDepositModule).to.be.equal(alice.address);
        await expect(vault.connect(governance).setDepositLimitModule(await limitDepositModule.getAddress()))
          .to.be.emit(vault, "UpdateDepositLimitModule")
          .withArgs(await limitDepositModule.getAddress());
        let postLimitDepositModule = (await vault.vaultData()).depositLimitModule;
        expect(postLimitDepositModule).to.be.equal(await limitDepositModule.getAddress());
      });
      it("update LimitDepositModule when has deposit limit should revert", async () => {
        await vault.connect(governance).setDepositLimit(amount);
        await expect(vault.connect(governance).setDepositLimitModule(await limitDepositModule.getAddress())).to.be.reverted;
      });
      it("update LimitDepositModuleForce when has deposit limit shound success, update depositLimit = maxUint256", async () => {
        await vault.connect(governance).setDepositLimit(amount);
        let preDepositLimit = (await vault.vaultData()).depositLimit;
        expect(preDepositLimit).eq(amount);
        await expect(vault.connect(governance).setDepositLimitModuleForce(await limitDepositModule.getAddress()))
          .to.be.emit(vault, "UpdateDepositLimitModule")
          .withArgs(await limitDepositModule.getAddress());
        let postLimitDepositModule = (await vault.vaultData()).depositLimitModule;
        expect(postLimitDepositModule).to.be.equal(await limitDepositModule.getAddress());
        let postDepositLimit = (await vault.vaultData()).depositLimit;
        expect(postDepositLimit).to.be.equal(ethers.MaxUint256);
      });
      it("update LimitDepositModule without permission should revert", async () => {
        await expect(vault.connect(alice).setDepositLimitModule(await limitDepositModule.getAddress())).to.be.reverted;
      });

      describe("with LimitDepositModule", async () => {
        let limitAmount = parseUnits("10", 6);
        beforeEach(async () => {
          await vault.connect(governance).setDepositLimitModule(await limitDepositModule.getAddress());
          await limitDepositModule.connect(governance).setLimitEachUser(limitAmount);
        });
        it("maxDeposit", async () => {
          let maxDeposit = await vault.maxDeposit(alice.address);
          expect(maxDeposit).to.be.equal(0);
          let maxBobDeposit = await vault.maxDeposit(bob.address);
          expect(maxBobDeposit).to.be.equal(limitAmount);
        });
        it("maxMint", async () => {
          let maxDeposit = await vault.maxMint(alice.address);
          expect(maxDeposit).to.be.equal(0);
          let maxBobDeposit = await vault.maxMint(bob.address);
          expect(maxBobDeposit).to.be.equal(limitAmount);
        });
      });
    });

    describe("LimitWithdrawModule", async () => {
      let limitWithdrawModule: WithdrawLimitModule;
      beforeEach(async () => {
        limitWithdrawModule = WithdrawLimitModule__factory.connect((await get("WithdrawLimitModule")).address, governance);
      });

      it(" update LimitWithdrawModule with permission should success", async () => {
        await expect(vault.connect(governance).setWithdrawLimitModule(await limitWithdrawModule.getAddress()))
          .to.be.emit(vault, "UpdateWithdrawLimitModule")
          .withArgs(await limitWithdrawModule.getAddress());
        let postLimitWithdrawModule = (await vault.vaultData()).withdrawLimitModule;
        expect(postLimitWithdrawModule).to.be.equal(await limitWithdrawModule.getAddress());
      });

      it(" update LimitWithdrawModule without permission should revert", async () => {
        await expect(vault.connect(alice).setWithdrawLimitModule(await limitWithdrawModule.getAddress())).to.be.reverted;
      });

      describe("with LimitWithdrawModule", async () => {
        let limitAmount = parseUnits("100", 6);
        beforeEach(async () => {
          await vault.connect(governance).setWithdrawLimitModule(await limitWithdrawModule.getAddress());
          await limitWithdrawModule.connect(governance).setLimitEachUser(limitAmount);
          await addStrategy(vault, strategy, governance);
          await mintAndDeposit(vault, usdc, amount, alice);
          await updateMaxDebt(vault, strategy, amount * 2n, governance);
          await updateDebt(vault, strategy, amount, governance);
        });
        it("maxWithdraw", async () => {
          let maxAliceWithdraw = await vault["maxWithdraw(address,uint256,address[])"](alice.address, 0, [await strategy.getAddress()]);
          expect(maxAliceWithdraw).to.be.equal(limitAmount);
        });
        it("withdraw bigger than limit should revert", async () => {
          await expect(vault.connect(alice).withdraw(limitAmount + 1n, alice.address, alice.address)).to.be.revertedWith("Exceed withdraw limit");
        });
        it("withdraw smaller than limit should success", async () => {
          await vault.connect(alice).withdraw(limitAmount - 1n, alice.address, alice.address);
        });
      });
    });
  });
});
