import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { assert, ethers as ethersv6, MaxUint256, parseEther, parseUnits } from "ethers";
import {
  addDebtToStrategy,
  addStrategy,
  mintAndDeposit,
  setDepositLimit,
  setDepositLimitModule,
  setLock,
  setLoss,
  setMaxDebt,
  setMinimumTotalIdle,
  updateDebt,
  updateMaxDebt,
} from "../helper";
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

  describe("ERC4626", () => {
    let amount = parseUnits("1000", 6);

    it("totalAssets()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      let totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(amount);
    });

    it("previewDeposit()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      let shares = await vault.balanceOf(alice.address);
      expect(await vault.previewDeposit(amount)).to.equal(shares);
    });

    it("previewMint()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      let shares = await vault.balanceOf(alice.address);
      expect(await vault.previewMint(shares)).to.equal(amount);
    });

    it("maxDeposit()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      expect(await vault.maxDeposit(alice.address)).to.equal(MaxUint256);
    });

    it("maxDeposit() with depositLimit", async () => {
      let amount = 10n ** 6n;
      await setDepositLimit(vault, amount / 2n, governance);
      expect(await vault.maxDeposit(alice.address)).to.equal(amount / 2n);
    });

    it("maxDeposit() with depositLimitModule", async () => {
      let limit_amount = 10n * 10n ** 6n;
      await setDepositLimitModule(vault, governance);

      expect(await vault.maxDeposit(alice.address)).to.equal(limit_amount);
    });

    it("maxDeposit() with total assets greater than or qual deposit limit return zero", async () => {
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, amount, alice);
      await setDepositLimit(vault, amount / 2n, governance);
      expect(await vault.maxDeposit(alice.address)).to.equal(0n);
    });

    it("maxDeposit() with total assets less than deposit limit return deposit limit minus total assets", async () => {
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, 1n, alice);
      await setDepositLimit(vault, amount / 2n, governance);
      expect(await vault.maxDeposit(alice.address)).to.equal(amount / 2n - 1n);
    });

    it("previewMint()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      let shares = await vault.balanceOf(alice.address);
      expect(await vault.previewMint(shares)).to.equal(amount);
    });
    it("maxMint() with total assets greater than or qual deposit limit return zero", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      await setDepositLimit(vault, 1n, governance);
      expect(await vault.maxMint(alice.address)).to.equal(0n);
    });

    it("maxMint() with total assets less than deposit limit return deposit limit minus total assets", async () => {
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, 1n, alice);
      await setDepositLimit(vault, amount / 2n, governance);
      expect(await vault.maxMint(alice.address)).to.equal(await vault.convertToShares(amount / 2n - 1n));
    });

    it("previewWithdraw()", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      let shares = await vault.balanceOf(alice.address);
      expect(await vault.previewWithdraw(amount)).to.equal(shares);
    });

    it("maxWithdraw() with balance greater than total idle returns balance", async () => {
      let strategyDeposit = amount / 2n;
      await mintAndDeposit(vault, usdc, amount, alice);
      await addStrategy(vault, strategy, governance);
      await addDebtToStrategy(vault, strategy, strategyDeposit, governance);
      expect(await vault["maxWithdraw(address)"](alice.address)).to.equal(amount);
    });

    it("maxWithdraw() with balance less or equal to total idle returns balance", async () => {
      let strategyDeposit = amount / 2n;
      await mintAndDeposit(vault, usdc, amount, alice);
      expect(await vault["maxWithdraw(address)"](alice.address)).to.equal(amount);
    });
  });

  describe("Debt", () => {
    let amountMint = parseUnits("1000", 6);
    let amountMaxDebt = parseUnits("1000", 6) / 2n;

    it("updateDebt() with inactive strategy", async () => {
      await expect(updateMaxDebt(vault, strategy, amountMint, governance)).to.be.revertedWith("Inactive strategy");
    });

    it("updateMaxDebt() with debt value", async () => {
      await addStrategy(vault, strategy, governance);
      await updateMaxDebt(vault, strategy, amountMaxDebt, governance);
      expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(amountMaxDebt);
    });

    it("updateMaxDebt() with different debt values", async () => {
      await addStrategy(vault, strategy, governance);

      // Test with 0
      await updateMaxDebt(vault, strategy, 0n, governance);
      expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(0n);

      // Test with large value
      let largeAmount = parseUnits("1000000", 6);
      await updateMaxDebt(vault, strategy, largeAmount, governance);
      expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(largeAmount);
    });

    it("updateDebt() without permission reverted", async () => {
      await addStrategy(vault, strategy, governance);
      await expect(updateDebt(vault, strategy, amountMaxDebt, alice)).to.be.revertedWith("Not governance");
    });

    it("updateDebt() with max debt less than new debt", async () => {
      let amount = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);

      let vaultBalance = await usdc.balanceOf(await vault.getAddress());
      await updateMaxDebt(vault, strategy, amount, governance);
      let newDebt = amount / 2n;
      await expect(updateDebt(vault, strategy, newDebt, governance))
        .to.be.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), 0, newDebt);

      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(newDebt);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(newDebt);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - newDebt);
      expect(await vault.totalIdle()).to.equal(vaultBalance - newDebt);
      expect(await vault.totalDebt()).to.equal(newDebt);
    });

    it("updateDebt() with current debt less than new debt", async () => {
      let amount = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);

      let vaultBalance = await usdc.balanceOf(await vault.getAddress());
      let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      let newDebt = amount / 2n;
      let difference = newDebt - currentDebt;
      let initialIdle = await vault.totalIdle();
      let initialDebt = await vault.totalDebt();

      await updateMaxDebt(vault, strategy, newDebt, governance);

      await expect(updateDebt(vault, strategy, newDebt, governance))
        .to.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), currentDebt, newDebt);

      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(newDebt);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(newDebt);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - newDebt);
      expect(await vault.totalIdle()).to.equal(initialIdle - difference);
      expect(await vault.totalDebt()).to.equal(initialDebt + difference);
    });

    it("updateDebt() with max debt equal to new debt reverted", async () => {
      let amount = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);

      let vaultBalance = await usdc.balanceOf(await vault.getAddress());
      await addDebtToStrategy(vault, strategy, amount, governance);
      await expect(updateDebt(vault, strategy, amount, governance)).to.be.revertedWith("No debt change");
    });

    it("updateDebt() with current debt greater than new debt and strategy has loss reverted", async () => {
      let amount = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, amount, alice);
      await addDebtToStrategy(vault, strategy, amount, governance);

      let lp = await strategy.balanceOf(await vault.getAddress());

      let amountStrategy = await usdc.balanceOf(await strategy.getAddress());

      await setLoss(strategy, amountStrategy / 10n, governance);

      await expect(updateDebt(vault, strategy, amount / 2n, governance)).to.be.revertedWith("Unrealised losses");
    });

    it("updateDebt() with current debt greater than new debt and insufficient withdrawable assets", async () => {
      let vaultBalance = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, vaultBalance, alice);
      await addDebtToStrategy(vault, strategy, vaultBalance, governance);

      let lockedDebt = vaultBalance / 2n;
      let newDebt = vaultBalance / 4n;
      let difference = vaultBalance - lockedDebt;

      await updateMaxDebt(vault, strategy, newDebt, governance);

      await setLock(strategy, lockedDebt, governance);

      let initialIdle = await vault.totalIdle();
      let initialDebt = await vault.totalDebt();

      await expect(updateDebt(vault, strategy, newDebt, governance))
        .to.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), vaultBalance, lockedDebt);

      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(lockedDebt);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(lockedDebt);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - lockedDebt);

      expect(await vault.totalIdle()).to.equal(initialIdle + difference);
      expect(await vault.totalDebt()).to.equal(initialDebt - difference);
    });

    it("updateDebt() with current debt greater than new debt and sufficient withdrawable assets", async () => {
      let vaultBalance = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, vaultBalance, alice);

      let newDebt = vaultBalance / 2n;
      let difference = vaultBalance - newDebt;
      await addDebtToStrategy(vault, strategy, vaultBalance, governance);

      let initialIdle = await vault.totalIdle();
      let initialDebt = await vault.totalDebt();

      await updateMaxDebt(vault, strategy, newDebt, governance);

      await expect(updateDebt(vault, strategy, newDebt, governance))
        .to.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), vaultBalance, newDebt);

      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(newDebt);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(newDebt);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - newDebt);
      expect(await vault.totalIdle()).to.equal(initialIdle + difference);
      expect(await vault.totalDebt()).to.equal(initialDebt - difference);
    });

    it("updateDebt() with new debt greater than max desired debt", async () => {
      let vaultBalance = parseUnits("1000", 6);
      await addStrategy(vault, strategy, governance);
      await mintAndDeposit(vault, usdc, vaultBalance, alice);

      let maxDebt = vaultBalance;
      let maxDesiredDebt = vaultBalance / 2n;
      let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
      let difference = maxDesiredDebt - currentDebt;
      let initialIdle = await vault.totalIdle();
      let initialDebt = await vault.totalDebt();

      await updateMaxDebt(vault, strategy, maxDebt, governance);

      await setMaxDebt(strategy, maxDesiredDebt, governance);

      await expect(updateDebt(vault, strategy, maxDebt, governance))
        .to.emit(vault, "DebtUpdated")
        .withArgs(await strategy.getAddress(), currentDebt, maxDesiredDebt);

      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(maxDesiredDebt);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(maxDesiredDebt);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - maxDesiredDebt);
      expect(await vault.totalIdle()).to.equal(initialIdle - difference);
      expect(await vault.totalDebt()).to.equal(initialDebt + difference);
    });

    describe("minimun total idle", () => {
      let minimumTotalIdle = parseUnits("100", 6);

      it("setMinimumTotalIdle() with minimum total idle", async () => {
        await expect(setMinimumTotalIdle(vault, minimumTotalIdle, governance)).to.emit(vault, "UpdateMinimumTotalIdle").withArgs(minimumTotalIdle);
        expect(await vault.minimumTotalIdle()).to.equal(minimumTotalIdle);
      });

      it("setMinimumTotalIdle() with different values", async () => {
        // Test with 0
        await expect(setMinimumTotalIdle(vault, 0n, governance)).to.emit(vault, "UpdateMinimumTotalIdle").withArgs(0n);
        expect(await vault.minimumTotalIdle()).to.equal(0n);

        // Test with large value
        let largeAmount = parseUnits("1000000", 6);
        await expect(setMinimumTotalIdle(vault, largeAmount, governance)).to.emit(vault, "UpdateMinimumTotalIdle").withArgs(largeAmount);
        expect(await vault.minimumTotalIdle()).to.equal(largeAmount);
      });

      it("setMinimumTotalIdle() without permission reverted", async () => {
        await expect(setMinimumTotalIdle(vault, minimumTotalIdle, alice)).to.be.revertedWith("Not governance");
      });

      it("upadteDebt() with current debt less than new debt and minumun total idle", async () => {
        let vaultBalance = parseUnits("1000", 6);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, vaultBalance, alice);
        await addDebtToStrategy(vault, strategy, vaultBalance, governance);

        let newDebt = vaultBalance / 2n;
        let difference = vaultBalance - newDebt;

        let initialIdle = await vault.totalIdle();
        let initialDebt = await vault.totalDebt();

        let minimumTotalIdle = 1n;
        await setMinimumTotalIdle(vault, minimumTotalIdle, governance);
        expect(await vault.minimumTotalIdle()).to.be.equal(minimumTotalIdle);

        await expect(updateDebt(vault, strategy, newDebt, governance))
          .to.emit(vault, "DebtUpdated")
          .withArgs(await strategy.getAddress(), vaultBalance, newDebt);

        expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(newDebt);
        expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(newDebt);
        expect(await usdc.balanceOf(await vault.getAddress())).to.equal(vaultBalance - newDebt);
        expect(await vault.totalIdle()).to.equal(initialIdle + difference);
        expect(await vault.totalDebt()).to.equal(initialDebt - difference);
        expect(await vault.totalIdle()).to.greaterThan(minimumTotalIdle);
      });

      it("upadteDebt() with current debt less than new debt and total idle lower than minumun total idle", async () => {
        let vaultBalance = parseUnits("1000", 6);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, vaultBalance, alice);

        let newDebt = vaultBalance / 2n;
        let minimumTotalIdle = await vault.totalIdle();
        await setMinimumTotalIdle(vault, minimumTotalIdle, governance);
        expect(await vault.minimumTotalIdle()).to.be.equal(await vault.totalIdle());

        await updateMaxDebt(vault, strategy, newDebt, governance);

        let preDebt = await vault.totalDebt();
        let preBalanceStrategy = await usdc.balanceOf(await strategy.getAddress());
        let preBalanceVault = await usdc.balanceOf(await vault.getAddress());

        let result = await updateDebt(vault, strategy, newDebt, governance, true);

        expect(result).to.be.equal(0n);

        let postDebt = await vault.totalDebt();
        let postBalanceStrategy = await usdc.balanceOf(await strategy.getAddress());
        let postBalanceVault = await usdc.balanceOf(await vault.getAddress());
        expect(preDebt).to.be.equal(postDebt);
        expect(preBalanceStrategy).to.be.equal(postBalanceStrategy);
        expect(preBalanceVault).to.be.equal(postBalanceVault);
      });

      it("updateDebt() with current debt less than new debt and minimum totak idle reducing new debt", async () => {
        let vaultBalance = parseUnits("1000", 6);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, vaultBalance, alice);
        //await addDebtToStrategy(vault, strategy, vaultBalance, governance);

        let new_debt = vaultBalance;
        let currentDebt = await vault.totalDebt();

        let initialIdle = await vault.totalIdle();
        let initialDebt = await vault.totalDebt();

        let minimumTotalIdle = vaultBalance - 1n;
        await setMinimumTotalIdle(vault, minimumTotalIdle, governance);
        expect(await vault.minimumTotalIdle()).to.be.equal((await vault.totalAssets()) - 1n);

        let expectNewDifference = initialIdle - minimumTotalIdle;
        let expectNewDebt = currentDebt + expectNewDifference;
        await updateMaxDebt(vault, strategy, new_debt, governance);
        expect(await updateDebt(vault, strategy, new_debt, governance))
          .to.emit(vault, "DebtUpdated")
          .withArgs(await strategy.getAddress(), currentDebt, expectNewDebt);
        let postDebt = await vault.totalDebt();
        let postBalanceStrategy = await usdc.balanceOf(await strategy.getAddress());
        let postBalanceVault = await usdc.balanceOf(await vault.getAddress());
        expect(postDebt).to.be.equal(expectNewDebt);
        expect(postBalanceStrategy).to.be.equal(expectNewDebt);
        expect(postBalanceVault).to.be.equal(vaultBalance - expectNewDebt);
        expect(await vault.totalIdle()).to.be.equal(initialIdle - expectNewDifference);
        expect(await vault.totalDebt()).to.be.equal(initialDebt + expectNewDifference);
      });

      it("updateDebt() with current debt greater than new debt and total idle greater than minimum total idle", async () => {
        let vaultBalance = parseUnits("1000", 6);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, vaultBalance, alice);
        let currentDebt = vaultBalance;
        await addDebtToStrategy(vault, strategy, currentDebt, governance);
        let newDebt = currentDebt / 3n;
        vaultBalance = await usdc.balanceOf(await vault.getAddress());
        let initialIdle = await vault.totalIdle();
        let initialDebt = await vault.totalDebt();

        let minimumTotalIdle = currentDebt - newDebt + 1n;
        await setMinimumTotalIdle(vault, minimumTotalIdle, governance);
        expect(await vault.minimumTotalIdle()).to.be.equal(currentDebt - newDebt + 1n);

        let expectNewDifference = minimumTotalIdle - initialIdle;
        let expectNewDebt = currentDebt - expectNewDifference;
        await updateMaxDebt(vault, strategy, newDebt, governance);
        expect(await updateDebt(vault, strategy, newDebt, governance))
          .to.emit(vault, "DebtUpdated")
          .withArgs(await strategy.getAddress(), currentDebt, expectNewDebt);

        expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(expectNewDebt);
        expect(await vault.totalIdle()).to.be.equal(initialIdle + expectNewDifference);
        expect(await vault.totalDebt()).to.be.equal(initialDebt - expectNewDifference);
        expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(expectNewDebt);
        expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance + expectNewDifference);
      });

      it("updateDebt() with current debt greater than new debt and total idle less than minimum total idle", async () => {
        let vaultBalance = parseUnits("1000", 6);
        await addStrategy(vault, strategy, governance);
        await mintAndDeposit(vault, usdc, vaultBalance, alice);
        let currentDebt = vaultBalance;
        await addDebtToStrategy(vault, strategy, currentDebt, governance);
        let newDebt = currentDebt / 3n;

        // We compute vault values again, as they have changed
        vaultBalance = await usdc.balanceOf(await vault.getAddress());
        let initialIdle = await vault.totalIdle();
        let initialDebt = await vault.totalDebt();

        // We set minimum total idle to a value greater than debt difference
        let minimumTotalIdle = currentDebt - newDebt + 1n;
        await setMinimumTotalIdle(vault, minimumTotalIdle, governance);
        expect(await vault.minimumTotalIdle()).to.be.equal(currentDebt - newDebt + 1n);

        // We compute expected changes in debt due to minimum total idle need
        let expectNewDifference = minimumTotalIdle - initialIdle;
        let expectNewDebt = currentDebt - expectNewDifference;

        // Reduce debt in strategy
        await updateMaxDebt(vault, strategy, newDebt, governance);

        await expect(updateDebt(vault, strategy, newDebt, governance))
          .to.emit(vault, "DebtUpdated")
          .withArgs(await strategy.getAddress(), currentDebt, expectNewDebt);

        expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(expectNewDebt);
        expect(await vault.totalIdle()).to.be.equal(initialIdle + expectNewDifference);
        expect(await vault.totalDebt()).to.be.equal(initialDebt - expectNewDifference);
        expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(expectNewDebt);
        expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance + expectNewDifference);
      });
    });

    // describe("Faulty strategies", () => {
    //   it("updateDebt() with faulty strategy that deposits less than requested", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     let currentDebt = vaultBalance;
    //     let expectedDebt = currentDebt / 2n;
    //     let difference = currentDebt - expectedDebt; // maximum we can withdraw

    //     // Note: MockStrategy doesn't have setDepositRatio function
    //     // In real implementation, this would simulate a strategy that only deposits 50% of requested amount

    //     await addDebtToStrategy(vault, strategy, currentDebt, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();

    //     // Check the strategy only took half and vault recorded it correctly
    //     expect(initialIdle).to.be.equal(expectedDebt);
    //     expect(initialDebt).to.be.equal(expectedDebt);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(expectedDebt);
    //     expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(expectedDebt);
    //   });

    //   it("updateDebt() with lossy strategy that withdraws less than requested", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     await addDebtToStrategy(vault, strategy, vaultBalance, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();
    //     let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    //     let loss = currentDebt / 10n;
    //     let newDebt = 0n;
    //     let difference = currentDebt - loss;

    //     await setLoss(strategy, loss, governance);

    //     let initialPps = await vault.pricePerShare();
    //     await expect(updateDebt(vault, strategy, 0n, governance))
    //       .to.emit(vault, "DebtUpdated")
    //       .withArgs(await strategy.getAddress(), currentDebt, newDebt);

    //     // Should have recorded the loss
    //     expect(await vault.pricePerShare()).to.be.lessThan(initialPps);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance - loss);
    //     expect(await vault.totalIdle()).to.be.equal(initialIdle + difference);
    //     expect(await vault.totalDebt()).to.be.equal(newDebt);
    //   });

    //   it("updateDebt() with lossy strategy that withdraws less than requested with max loss", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     await addDebtToStrategy(vault, strategy, vaultBalance, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();
    //     let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    //     let loss = currentDebt / 10n;
    //     let newDebt = 0n;
    //     let difference = currentDebt - loss;

    //     await setLoss(strategy, loss, governance);

    //     let initialPps = await vault.pricePerShare();

    //     // Note: updateDebt function doesn't support max loss parameter in current implementation
    //     // These tests would require the vault to support max loss parameter in updateDebt
    //     // For now, we test the basic functionality without max loss checks

    //     await expect(updateDebt(vault, strategy, 0n, governance))
    //       .to.emit(vault, "DebtUpdated")
    //       .withArgs(await strategy.getAddress(), currentDebt, newDebt);

    //     // Should have recorded the loss
    //     expect(await vault.pricePerShare()).to.be.lessThan(initialPps);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance - loss);
    //     expect(await vault.totalIdle()).to.be.equal(initialIdle + difference);
    //     expect(await vault.totalDebt()).to.be.equal(newDebt);
    //   });

    //   it("updateDebt() with faulty strategy that withdraws more than requested", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     await addDebtToStrategy(vault, strategy, vaultBalance, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();
    //     let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    //     let extra = currentDebt / 10n;
    //     let newDebt = 0n;
    //     let difference = currentDebt;

    //     // Note: In real implementation, strategy would have extra funds and return more than requested
    //     // For MockStrategy, we simulate this by airdropping extra funds to strategy
    //     await usdc.connect(governance).mint(await strategy.getAddress(), extra);

    //     let initialPps = await vault.pricePerShare();
    //     await expect(updateDebt(vault, strategy, 0n, governance))
    //       .to.emit(vault, "DebtUpdated")
    //       .withArgs(await strategy.getAddress(), currentDebt, newDebt);

    //     expect(await vault.pricePerShare()).to.be.equal(initialPps);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(newDebt);
    //     expect(await strategy.totalAssets()).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance + extra);
    //     expect(await vault.totalIdle()).to.be.equal(vaultBalance);
    //     expect(await vault.totalDebt()).to.be.equal(newDebt);
    //   });

    //   it("updateDebt() with faulty strategy that deposits less than requested with airdrop", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     let fishAmount = parseUnits("100", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     // Airdrop some asset to the vault
    //     await usdc.connect(governance).mint(await vault.getAddress(), fishAmount);

    //     let currentDebt = vaultBalance;
    //     let expectedDebt = currentDebt / 2n;
    //     let difference = currentDebt - expectedDebt; // maximum we can withdraw

    //     await addDebtToStrategy(vault, strategy, currentDebt, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();

    //     // Check the strategy only took half and vault recorded it correctly
    //     expect(initialIdle).to.be.equal(expectedDebt);
    //     expect(initialDebt).to.be.equal(expectedDebt);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(expectedDebt);
    //     expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(expectedDebt);
    //   });

    //   it("updateDebt() with lossy strategy that withdraws less than requested with airdrop", async () => {
    //     let vaultBalance = parseUnits("1000", 6);
    //     let fishAmount = parseUnits("100", 6);
    //     await addStrategy(vault, strategy, governance);
    //     await mintAndDeposit(vault, usdc, vaultBalance, alice);

    //     await addDebtToStrategy(vault, strategy, vaultBalance, governance);

    //     let initialIdle = await vault.totalIdle();
    //     let initialDebt = await vault.totalDebt();
    //     let currentDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    //     let loss = currentDebt / 10n;
    //     let newDebt = 0n;
    //     let difference = currentDebt - loss;

    //     await setLoss(strategy, loss, governance);

    //     let initialPps = await vault.pricePerShare();

    //     // Airdrop some asset to the vault
    //     await usdc.connect(governance).mint(await vault.getAddress(), fishAmount);

    //     await expect(updateDebt(vault, strategy, 0n, governance))
    //       .to.emit(vault, "DebtUpdated")
    //       .withArgs(await strategy.getAddress(), currentDebt, newDebt);

    //     expect(await vault.pricePerShare()).to.be.lessThan(initialPps);
    //     expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await strategy.getAddress())).to.be.equal(newDebt);
    //     expect(await usdc.balanceOf(await vault.getAddress())).to.be.equal(vaultBalance - loss + fishAmount);
    //     expect(await vault.totalIdle()).to.be.equal(initialIdle + difference);
    //     expect(await vault.totalDebt()).to.be.equal(newDebt);
    //   });
    // });
  });
});
