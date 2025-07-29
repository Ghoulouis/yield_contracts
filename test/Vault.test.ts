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
import { ethers as ethersv6, MaxUint256, parseUnits, } from "ethers";
import { BigNumber } from "ethers";
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

  describe("****configurator test: queue and strategies (All behavior)", () => {
    let strategy1: MockStrategy;
    let strategy2: MockStrategy;
    let strategy3: MockStrategy;
    let amount = parseUnits("1000", 6);
    let maxDebt = parseUnits("10000000", 6);
    let snapshot: SnapshotRestorer;

    beforeEach(async () => {
      snapshot = await takeSnapshot();
      await mintAndDeposit(vault, usdc, amount, alice);
      const MockStrategyFactory = await hre.ethers.getContractFactory("MockStrategy");
      strategy1 = await MockStrategyFactory.deploy();
      strategy2 = await MockStrategyFactory.deploy();
      strategy3 = await MockStrategyFactory.deploy();
      await strategy1.connect(governance).initialize(
        await vault.getAddress(),
        governance.address,
        governance.address,
        await usdc.getAddress(),
        "Strategy1",
        "STR1"
      );
      await strategy2.connect(governance).initialize(
        await vault.getAddress(),
        governance.address,
        governance.address,
        await usdc.getAddress(),
        "Strategy2",
        "STR2"
      );
      await strategy3.connect(governance).initialize(
        await vault.getAddress(),
        governance.address,
        governance.address,
        await usdc.getAddress(),
        "Strategy3",
        "STR3"
      );
    });

    afterEach(async () => {
      await snapshot.restore();
    });
    describe("add strategy", () => {
      it("add strategies - should add 3 strategies to vault and queue", async () => {
        expect((await vault.strategies(strategy1.getAddress())).activation).to.equal(0);
        expect((await vault.strategies(strategy2.getAddress())).activation).to.equal(0);
        expect((await vault.strategies(strategy3.getAddress())).activation).to.equal(0);

        await addStrategy(vault, strategy1, governance);
        await addStrategy(vault, strategy2, governance);
        await addStrategy(vault, strategy3, governance);
        expect((await vault.strategies(strategy1.getAddress())).activation).to.not.equal(0);
        expect((await vault.strategies(strategy2.getAddress())).activation).to.not.equal(0);
        expect((await vault.strategies(strategy3.getAddress())).activation).to.not.equal(0);
      });
      it("add strategy - should revert if not QUEUE_MANAGER", async () => {
        await expect(
          vault.connect(alice).addStrategy(strategy1.getAddress(), true)
        ).to.be.reverted;
      });
      it("add strategy - with valid strategy", async () => {
        const blockBefore = await provider.getBlock("latest");
        const timestampBefore = blockBefore!.timestamp;
        await addStrategy(vault, strategy1, governance);
        const strategyParams = await vault.strategies(strategy1.getAddress());
        expect(strategyParams.activation).to.be.closeTo(timestampBefore + 1, 2);
        expect(strategyParams.currentDebt).to.equal(0);
        expect(strategyParams.maxDebt).to.equal(0);
        expect(strategyParams.lastReport).to.be.closeTo(timestampBefore + 1, 2);
      });

      it("add strategy - with zero address - fails with error", async () => {
        await expect(
          vault.connect(governance).addStrategy(ethersv6.ZeroAddress, true)
        ).to.be.revertedWith("Invalid strategy");
      });
      it("add strategy - with already active strategy - fails with error", async () => {
        await addStrategy(vault, strategy1, governance);
        await expect(
          vault.connect(governance).addStrategy(strategy1.getAddress(), true)
        ).to.be.revertedWith("Strategy already active");
      });
    });
    describe("Default Queue - Max Length", () => {
      let strategies: MockStrategy[];
      let snapshot: SnapshotRestorer;

      beforeEach(async () => {
        snapshot = await takeSnapshot();
        const { deployer } = await getNamedAccounts();
        governance = await hre.ethers.getSigner(deployer);
        vault = Vault__factory.connect((await get("Vault")).address, governance);
        strategies = [];
        const MockStrategyFactory = await hre.ethers.getContractFactory("MockStrategy");
        for (let i = 0; i < 11; i++) {
          const strategy = await MockStrategyFactory.deploy();
          await strategy.connect(governance).initialize(
            await vault.getAddress(),
            governance.address,
            governance.address,
            (await get("USDC")).address,
            `Strategy${i}`,
            `STR${i}`
          );
          strategies.push(strategy);
        }
      });

      afterEach(async () => {
        await snapshot.restore();
      });

      it("add 11 strategies - queue limited to 10", async () => {
        for (let i = 0; i < 10; i++) {
          await addStrategy(vault, strategies[i], governance);
        }

        await addStrategy(vault, strategies[10], governance);
        expect((await vault.strategies(strategies[10].getAddress())).activation).to.not.equal(0);
      });
    });
    describe("revokeStrategy", () => {
      beforeEach(async () => {
        await addStrategy(vault, strategy1, governance);
        await addStrategy(vault, strategy2, governance);
      });

      it("should revoke strategy and remove from queue", async () => {
        const strategyAddress = await strategy1.getAddress();
        expect((await vault.strategies(strategyAddress)).activation).to.not.equal(0);

        await vault.connect(governance).revokeStrategy(strategyAddress);

        expect((await vault.strategies(strategyAddress)).activation).to.equal(0);

      });

      it("should revert if strategy is not active", async () => {
        await expect(
          vault.connect(governance).revokeStrategy(strategy3.getAddress())
        ).to.be.revertedWith("Strategy not active");
      });

      it("should revert if strategy has debt and not forced", async () => {
        await vault.connect(governance).updateMaxDebtForStrategy(strategy1.getAddress(), amount);
        await vault.connect(governance).updateDebt(strategy1.getAddress(), amount, 0);
        await expect(
          vault.connect(governance).revokeStrategy(strategy1.getAddress())
        ).to.be.revertedWith("Strategy has debt");
      });

      it("should revert if not QUEUE_MANAGER", async () => {
        await expect(
          vault.connect(alice).revokeStrategy(strategy1.getAddress())
        ).to.be.reverted;
      });
    });
    describe("forceRevokeStrategy", () => {
      beforeEach(async () => {
        await addStrategy(vault, strategy1, governance);
        await updateMaxDebt(vault, strategy1, amount, governance);
        await updateDebt(vault, strategy1, amount, governance);
      });

      it("should force revoke strategy with debt and update totalDebt", async () => {
        const strategyAddress = await strategy1.getAddress();
        const initialTotalDebt = await vault.totalDebt();
        const strategyParams = await vault.strategies(strategyAddress);
        expect(strategyParams.currentDebt).to.equal(amount);
        expect(initialTotalDebt).to.equal(amount);
        const tx = await vault.connect(governance).forceRevokeStrategy(strategyAddress);
        const finalParams = await vault.strategies(strategyAddress);
        expect(finalParams.activation).to.equal(0);
        expect(finalParams.currentDebt).to.equal(0);
        expect(finalParams.maxDebt).to.equal(0);
        expect(finalParams.lastReport).to.equal(0);
        expect(await vault.totalDebt()).to.equal(0);
        await expect(vault.connect(governance).setDefaultQueue([strategyAddress])).to.be.revertedWith("Inactive strategy");
      });

      it("should revert if strategy is not active", async () => {
        await expect(
          vault.connect(governance).forceRevokeStrategy(strategy3.getAddress())
        ).to.be.revertedWith("Strategy not active");
      });

      it("should revert if not QUEUE_MANAGER", async () => {
        await expect(
          vault.connect(alice).forceRevokeStrategy(strategy1.getAddress())
        ).to.be.reverted;
      });
    });

    describe("setDefaultQueue", () => {
      beforeEach(async () => {
        await addStrategy(vault, strategy1, governance);
        await addStrategy(vault, strategy2, governance);
        await addStrategy(vault, strategy3, governance);
      });

      it("should set new default queue with active strategies", async () => {
        const newQueue = [await strategy2.getAddress(), await strategy1.getAddress()];
        const tx = await vault.connect(governance).setDefaultQueue(newQueue);
        await vault.connect(governance).revokeStrategy(await strategy3.getAddress());
        await expect(vault.connect(governance).setDefaultQueue([await strategy3.getAddress()])).to.be.revertedWith("Inactive strategy");
      });

      it("should revert if queue length exceeds MAX_QUEUE", async () => {
        const tooLongQueue = new Array(21).fill(await strategy1.getAddress());
        await expect(
          vault.connect(governance).setDefaultQueue(tooLongQueue)
        ).to.be.revertedWith("Queue too long");
      });

      it("should revert if queue contains inactive strategy", async () => {
        await vault.connect(governance).revokeStrategy(strategy3.getAddress());
        const invalidQueue = [await strategy1.getAddress(), await strategy3.getAddress()];
        await expect(
          vault.connect(governance).setDefaultQueue(invalidQueue)
        ).to.be.revertedWith("Inactive strategy");
      });

      it("should revert if not QUEUE_MANAGER", async () => {
        const newQueue = [await strategy1.getAddress()];
        await expect(
          vault.connect(alice).setDefaultQueue(newQueue)
        ).to.be.reverted;
      });
    });

    describe("setUseDefaultQueue", () => {
      it("should enable useDefaultQueue", async () => {
        const tx = await vault.connect(governance).setUseDefaultQueue(true);
        const events = await tx.wait().then((receipt) => receipt!.logs.map(log => vault.interface.parseLog(log)));
        expect(events.some(event => event?.name === "UpdateUseDefaultQueue" && event.args.useDefaultQueue === true)).to.be.true;
      });

      it("should disable useDefaultQueue", async () => {
        await vault.connect(governance).setUseDefaultQueue(true);
        const tx = await vault.connect(governance).setUseDefaultQueue(false);
        const events = await tx.wait().then((receipt) => receipt!.logs.map(log => vault.interface.parseLog(log)));
        expect(events.some(event => event?.name === "UpdateUseDefaultQueue" && event.args.useDefaultQueue === false)).to.be.true;
      });

      it("should revert if not QUEUE_MANAGER", async () => {
        await expect(
          vault.connect(alice).setUseDefaultQueue(true)
        ).to.be.reverted;
      });
    });

    describe("setAutoAllocate", () => {
      it("should enable autoAllocate", async () => {
        const tx = await vault.connect(governance).setAutoAllocate(true);
        const events = await tx.wait().then((receipt) => receipt!.logs.map(log => vault.interface.parseLog(log)));
        expect(events.some(event => event?.name === "UpdateAutoAllocate" && event.args.autoAllocate === true)).to.be.true;
      });

      it("should disable autoAllocate", async () => {
        await vault.connect(governance).setAutoAllocate(true);
        const tx = await vault.connect(governance).setAutoAllocate(false);
        const events = await tx.wait().then((receipt) => receipt!.logs.map(log => vault.interface.parseLog(log)));
        expect(events.some(event => event?.name === "UpdateAutoAllocate" && event.args.autoAllocate === false)).to.be.true;
      });

      it("should revert if not QUEUE_MANAGER", async () => {
        await expect(
          vault.connect(alice).setAutoAllocate(true)
        ).to.be.reverted;
      });
    });
    describe("updateDebt with multiple strategies", () => {
      beforeEach(async () => {
        await addStrategy(vault, strategy1, governance);
        await addStrategy(vault, strategy2, governance);
        await addStrategy(vault, strategy3, governance);
        await updateMaxDebt(vault, strategy1, maxDebt, governance);
        await updateMaxDebt(vault, strategy2, maxDebt, governance);
        await updateMaxDebt(vault, strategy3, maxDebt, governance);
        await mintAndDeposit(vault, usdc, amount, alice);
      });

      it("should allocate debt to the first strategy in the queue", async () => {
        await updateDebt(vault, strategy1, amount, governance);

        const strategy1Debt = (await vault.strategies(strategy1.getAddress())).currentDebt;
        const strategy2Debt = (await vault.strategies(strategy2.getAddress())).currentDebt;
        const strategy3Debt = (await vault.strategies(strategy3.getAddress())).currentDebt;

        expect(strategy1Debt).to.equal(amount);
        expect(strategy2Debt).to.equal(0);
        expect(strategy3Debt).to.equal(0);

      });

      it("should respect queue order when allocating debt", async () => {
        const newQueue = [await strategy2.getAddress(), await strategy1.getAddress(), await strategy3.getAddress()];
        await vault.connect(governance).setDefaultQueue(newQueue);
        await vault.connect(governance).setUseDefaultQueue(true);

        await updateDebt(vault, strategy2, amount, governance);

        const strategy1Debt = (await vault.strategies(strategy1.getAddress())).currentDebt;
        const strategy2Debt = (await vault.strategies(strategy2.getAddress())).currentDebt;
        const strategy3Debt = (await vault.strategies(strategy3.getAddress())).currentDebt;

        expect(strategy2Debt).to.equal(amount);
        expect(strategy1Debt).to.equal(0);
        expect(strategy3Debt).to.equal(0);

      });
    });
  });
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

  describe("Buy Debt", () => {
    let limitDepositModule: DepositLimitModule;
    let debtAmount = amount / 3n;
    beforeEach(async () => {
      limitDepositModule = DepositLimitModule__factory.connect((await get("DepositLimitModule")).address, governance);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);
      await updateMaxDebt(vault, strategy, amount * 2n, governance);
      await updateDebt(vault, strategy, amount, governance);

      await usdc.connect(governance).mint(governance.address, debtAmount);
      await usdc.connect(governance).approve(await vault.getAddress(), debtAmount);
    });

    it("can buy debt with permission should success", async () => {
      let preDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      await expect(vault.connect(governance).buyDebt(await strategy.getAddress(), debtAmount))
        .to.be.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), preDebt, preDebt - debtAmount)
        .to.be.emit(vault, "DebtPurchased")
        .withArgs(await strategy.getAddress(), debtAmount);
      let postDebt = await vault.strategies(await strategy.getAddress());
      expect(postDebt.currentDebt).to.be.equal(preDebt - debtAmount);
    });

    it("buy debt without permission should revert", async () => {
      await usdc.connect(governance).mint(alice.address, debtAmount);
      await usdc.connect(alice).approve(await vault.getAddress(), debtAmount);
      await expect(vault.connect(alice).buyDebt(await strategy.getAddress(), debtAmount)).to.be.reverted;
    });
  });

  describe("Minimum Total Idle", async () => {
    let mimimum = amount / 10n;
    beforeEach(async () => {
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);
      await updateMaxDebt(vault, strategy, amount * 10n, governance);
      await updateDebt(vault, strategy, amount, governance);
    });
    it(" set Minimum Total Idle with permission should success", async () => {
      await expect(vault.connect(governance).setMinimumTotalIdle(mimimum)).to.be.emit(vault, "UpdateMinimumTotalIdle").withArgs(mimimum);
      let postMinimumTotalIdle = (await vault.vaultData()).minimumTotalIdle;
      expect(postMinimumTotalIdle).to.be.equal(mimimum);
    });
    it(" set Minimum Total Idle without permission should revert", async () => {
      await expect(vault.connect(alice).setMinimumTotalIdle(mimimum)).to.be.reverted;
    });
    it(" should withdraw mimimumTotalIdle - totalIdle when updateDebt ", async () => {
      let preTotalIdle = await vault.totalIdle();
      await vault.connect(governance).setMinimumTotalIdle(mimimum);
      await vault.setAutoAllocate(true);
      await mintAndDeposit(vault, usdc, amount, alice);
      let posTotalIdle = await vault.totalIdle();
      expect(posTotalIdle).eq(mimimum);
    });
  });
});
