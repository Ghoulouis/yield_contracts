import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Accountant, Accountant__factory, ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts, network } from "hardhat";
import hre from "hardhat";
import { assert, ethers as ethersv6, parseUnits } from "ethers";
import { addDebtToStrategy, addStrategy, mintAndDeposit, processReport, setFee, setLoss } from "../helper";
import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";

describe("Profit Unlocking", () => {
  let vault: Vault;
  let usdc: ERC20Mintable;
  let provider = hre.ethers.provider;
  let governance: HardhatEthersSigner;
  let alice: ethersv6.Wallet;
  let bob: ethersv6.Wallet;
  let amount = 10n ** 6n;
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;
  let accountant: Accountant;
  let flexibleAccountant: Accountant;
  const WEEK = 7 * 24 * 60 * 60;
  const MAX_BPS_ACCOUNTANT = 10_000n;
  const YEAR = 31_556_952; // 1 year in seconds
  before(async () => {
    await hre.deployments.fixture();
    let { deployer, agent, beneficiary } = await getNamedAccounts();
    governance = await hre.ethers.getSigner(deployer);
    const { get } = hre.deployments;
    usdc = ERC20Mintable__factory.connect((await get("USDC")).address, provider);
    vault = Vault__factory.connect((await get("Vault")).address, governance);
    strategy = MockStrategy__factory.connect((await get("MockStrategy")).address, governance);
    accountant = Accountant__factory.connect((await get("Accountant")).address, governance);
    flexibleAccountant = Accountant__factory.connect((await get("FlexibleAccountant")).address, governance);
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

  async function createAndCheckProfit(profit: bigint, totalFees: bigint = 0n, totalRefunds: bigint = 0n) {
    let initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    await usdc.connect(governance).mint(await strategy.getAddress(), profit);
    await strategy.connect(governance).harvest();
    let tx = await vault.connect(governance).processReport(await strategy.getAddress());
    let receipt = await tx.wait();
    let eventSignature = vault.interface.getEvent("StrategyReported").format();
    let topic = ethersv6.id(eventSignature);
    let event = receipt?.logs.find((log: any) => log.topics[0] === topic);
    let parsed = vault.interface.parseLog(event!);
    expect(parsed?.args!.strategy).to.equal(await strategy.getAddress());
    expect(parsed?.args!.gain).to.closeTo(profit, 1n);
    expect(parsed?.args!.loss).to.equal(0);
    expect(parsed?.args!.currentDebt).to.closeTo(initialDebt + profit, 1n);
    expect(parsed?.args!.protocolFees).to.equal(0);
    expect(parsed?.args!.totalFees).to.equal(0);
    expect(parsed?.args!.totalRefunds).to.equal(totalRefunds);
  }
  async function createAndCheckLoss(
    strategy: MockStrategy,
    signer: HardhatEthersSigner,
    vault: Vault,
    loss: bigint,
    totalFees: bigint = 0n,
    totalRefunds: bigint = 0n
  ) {
    const initialDebt = (await vault.strategies(await strategy.getAddress())).currentDebt;
    await setLoss(strategy, loss, signer);
    const tx = await vault.connect(signer).processReport(await strategy.getAddress());
    const receipt = await tx.wait();
    const eventSignature = vault.interface.getEvent("StrategyReported").format();
    const topic = ethersv6.id(eventSignature);
    const event = receipt?.logs.find((log: any) => log.topics[0] === topic);
    const parsed = vault.interface.parseLog(event!);
    expect(parsed?.args!.strategy).to.equal(await strategy.getAddress());
    expect(parsed?.args!.gain).to.equal(0);
    expect(parsed?.args!.loss).to.closeTo(loss, 1n);
    expect(parsed?.args!.currentDebt).to.closeTo(initialDebt - loss, 1n);
    expect(parsed?.args!.protocolFees).to.equal(0);
    expect(parsed?.args!.totalFees).to.equal(totalFees);
    expect(parsed?.args!.totalRefunds).to.equal(totalRefunds);
  }

  async function checkPricePerShare(price: bigint) {
    let pricePerShare = await vault.pricePerShare();

    expect(pricePerShare).to.closeTo(price * 10n ** (await usdc.decimals()), 1n);
  }

  async function checkVaultTotals(totalDebt: bigint, totalIdle: bigint, totalAssets: bigint, totalSupply: bigint) {
    let vaultTotals = await vault.totalAssets();
    expect(vaultTotals).to.closeTo(totalAssets, 1n);
    let vaultDebt = await vault.totalDebt();
    expect(vaultDebt).to.closeTo(totalDebt, 1n);
    let vaultSupply = await vault.totalSupply();

    expect(vaultSupply / 10n ** ((await vault.decimals()) - (await usdc.decimals()))).to.closeTo(totalSupply, 1n);
  }

  async function increaseTimeAndCheckProfitBuffer(secs: number = 10 * 24 * 60 * 60, expectedBuffer: bigint = 0n) {
    await network.provider.send("evm_increaseTime", [secs - 1]);
    await network.provider.send("evm_mine");
    await processReport(vault, strategy, governance);
    await expect(await vault.balanceOf(await vault.getAddress())).to.closeTo(expectedBuffer, 1n);
  }

  async function initialSetUp(
    accountant: Accountant,
    debt_amount: bigint,
    managementFee: bigint = 0n,
    performentFee: bigint = 0n,
    refundRatio: bigint = 0n,
    accountantMint: bigint = 0n
  ) {
    let amount = parseUnits("10000", 6);

    if (managementFee > 0n || performentFee > 0n || refundRatio > 0n) {
      await setFee(accountant, strategy, managementFee, performentFee, refundRatio, governance);
      await vault.connect(governance).setAccountant(await accountant.getAddress());
    }

    if (accountantMint > 0n) {
      await usdc.connect(governance).mint(await accountant.getAddress(), accountantMint);
    }

    await mintAndDeposit(vault, usdc, amount / 10n, alice);
    await addStrategy(vault, strategy, governance);
    await addDebtToStrategy(vault, strategy, debt_amount, governance);
  }
async function consoleCheckVaultTotals(
  expectedDebt: bigint,
  expectedIdle: bigint,
  expectedAssets: bigint,
  expectedSupply: bigint
) {
  const [vaultDebt, vaultAssets, vaultSupplyRaw, vaultDecimals, usdcDecimals] = await Promise.all([
    vault.totalDebt(),
    vault.totalAssets(),
    vault.totalSupply(),
    vault.decimals(),
    usdc.decimals(),
  ]);

  const vaultSupply = vaultSupplyRaw / 10n ** (vaultDecimals - usdcDecimals);
  const actualIdle = vaultAssets - vaultDebt;

  console.log("======== consoleCheckVaultTotals ========");
  console.log(`Debt:         expected = ${expectedDebt}, actual = ${vaultDebt}`);
  console.log(`Idle:         expected = ${expectedIdle}, actual = ${actualIdle}`);
  console.log(`Assets:       expected = ${expectedAssets}, actual = ${vaultAssets}`);
  console.log(`Total Supply: expected = ${expectedSupply}, actual = ${vaultSupply}`);
  console.log("=========================================");
}
  let fishAmount = parseUnits("10000", 6);
  it("test gain no fees no refunds no exitsting buffer", async () => {
    let amount = fishAmount / 10n;
    let firstProfit = fishAmount / 10n;
    await mintAndDeposit(vault, usdc, amount, alice);
    await addStrategy(vault, strategy, governance);
    await addDebtToStrategy(vault, strategy, firstProfit, governance);
    await createAndCheckProfit(firstProfit);
    await checkPricePerShare(1n);
    await checkVaultTotals(amount + firstProfit, 0n, amount + firstProfit, amount + firstProfit);
    await increaseTimeAndCheckProfitBuffer();
    await checkPricePerShare(2n);
    await addDebtToStrategy(vault, strategy, 0n, governance);
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0n);
    await checkPricePerShare(2n);
    await checkVaultTotals(0n, amount + firstProfit, amount + firstProfit, amount);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    await checkPricePerShare(1n);
    await checkVaultTotals(0n, 0n, 0n, 0n);
    expect(await usdc.balanceOf(alice.address)).to.equal(amount + firstProfit);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);
  });

  it("test gain no fees with refunds accountant not enough shares", async () => {
    let fishAmount = parseUnits("10000", 6);

    let amount = fishAmount / 10n;
    let firstProfit = fishAmount / 10n;
    let managementFee = 0n;
    let performentFee = 0n;
    let refundRatio = 10_000n;

    await initialSetUp(flexibleAccountant, amount, managementFee, performentFee, refundRatio, firstProfit / 10n);
    await createAndCheckProfit(firstProfit, 0n, firstProfit / 10n);

    expect(await vault.convertToAssets(await vault.balanceOf(await vault.getAddress()))).to.equal(firstProfit + firstProfit / 10n);

    await checkPricePerShare(1n);
    await checkVaultTotals(amount + firstProfit, firstProfit / 10n, amount + firstProfit + firstProfit / 10n, amount + firstProfit + firstProfit / 10n);
  });

  it("test gain no fees with refunds no buffer", async () => {
    let fishAmount = parseUnits("10000", 6);

    let amount = fishAmount / 10n;
    let firstProfit = fishAmount / 10n;
    let managementFee = 0n;
    let performentFee = 0n;
    let refundRatio = 10_000n;

    await initialSetUp(flexibleAccountant, amount, managementFee, performentFee, refundRatio, 2n * amount);

    let totalRefunds = (firstProfit * refundRatio) / 10_000n;
    await createAndCheckProfit(firstProfit, 0n, totalRefunds);
    await checkPricePerShare(1n);
    await checkVaultTotals(amount + firstProfit, totalRefunds, amount + firstProfit + totalRefunds, amount + firstProfit + totalRefunds);
    expect(await vault.convertToAssets(await vault.balanceOf(vault))).to.equal(firstProfit + totalRefunds);
    expect(await vault.convertToAssets(await vault.balanceOf(flexibleAccountant))).to.equal(0n);
    await increaseTimeAndCheckProfitBuffer();
    await checkPricePerShare(3n);
    await checkVaultTotals(amount + firstProfit, totalRefunds, amount + firstProfit + totalRefunds, amount);
    await addDebtToStrategy(vault, strategy, 0n, governance);
    await checkVaultTotals(0n, amount + firstProfit + totalRefunds, amount + firstProfit + totalRefunds, amount);
    await checkPricePerShare(3n);
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0n);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    await checkPricePerShare(1n);
    await checkVaultTotals(0n, 0n, 0n, 0n);
    expect(await usdc.balanceOf(alice.address)).to.equal(amount + firstProfit + totalRefunds);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);

    await expect(vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address)).to.be.revertedWith("No shares to redeem");
  });
  /* TEST LOSS */
  describe("Test Lost Case", () => {
    it("test loss no fees no refunds no existing buffer", async () => {
      const fishAmount = parseUnits("10000", 6);
      const amount = fishAmount / 10n;
      const firstLoss = fishAmount / 20n;
      const managementFee = 0n;
      const performanceFee = 0n;
      const refundRatio = 0n;
      await initialSetUp(flexibleAccountant, amount, managementFee, performanceFee, refundRatio, amount);
      await createAndCheckLoss(strategy, governance, vault, firstLoss, 0n);
      console.log("price per share: (expect 0.5n):", await vault.pricePerShare()); // OK
      expect(await vault.balanceOf(await vault.getAddress())).to.equal(0n);
      await checkVaultTotals(amount - firstLoss, 0n, amount - firstLoss, amount);
      await addDebtToStrategy(vault, strategy, 0n, governance);
      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0n);
      console.log("price per share: (expect 0.5n):", await vault.pricePerShare());
      await checkVaultTotals(0n, amount - firstLoss, amount - firstLoss, amount);
      await vault.connect(alice)["redeem(uint256,address,address)"](await vault.balanceOf(alice.address), alice.address, alice.address);
      await checkPricePerShare(1n);
      await checkVaultTotals(0n, 0n, 0n, 0n);
      expect(await usdc.balanceOf(alice.address)).to.equal(amount - firstLoss); // 500_000_000
    });
    it("test loss fees no refunds no existing buffer", async () => {
      const fishAmount = parseUnits("10000", 6);
      const amount = fishAmount / 10n;
      const firstLoss = fishAmount / 20n;
      const managementFee = 10_000n;
      const performanceFee = 0n;
      const refundRatio = 0n;
      await initialSetUp(flexibleAccountant, amount, managementFee, performanceFee, refundRatio, amount);
      const totalFees = 0n; // no refund, no buffer
      await createAndCheckLoss(strategy, governance, vault, firstLoss, totalFees);
      const feesShares = await vault.convertToShares(totalFees);
      // PPS ~ 0.5
      expect((await vault.pricePerShare()) / 10n ** (await vault.decimals())).to.be.lt(
        parseUnits("0.5", await vault.decimals())
      );
      expect(await vault.balanceOf(await vault.getAddress())).to.equal(0n);
      await checkVaultTotals(amount - firstLoss, 0n, amount - firstLoss, amount + feesShares);
      await addDebtToStrategy(vault, strategy, 0n, governance);
      const aliceShares = await vault.balanceOf(alice.address);
      await vault.connect(alice)["redeem(uint256,address,address)"](aliceShares, alice.address, alice.address);
      await checkVaultTotals(
        0n,
        totalFees,
        totalFees,
        await vault.balanceOf(await flexibleAccountant.getAddress())
      );
      expect(await usdc.balanceOf(alice.address)).to.be.lt(fishAmount - firstLoss);
      const accAddr = await flexibleAccountant.getAddress();
      const accShares = await vault.balanceOf(accAddr);
      if (accShares > 0n) {
        await vault.connect(governance)["redeem(uint256,address,address)"](accShares, accAddr, accAddr);
      }
      await checkVaultTotals(0n, 0n, 0n, 0n);
    });

    it("test loss no fees refunds no existing buffer", async () => {
      const fishAmount = parseUnits("10000", 6);
      const amount = fishAmount / 10n;
      const firstLoss = fishAmount / 10n;
      const managementFee = 0n;
      const performanceFee = 0n;
      const refundRatio = 10_000n;
      await initialSetUp(flexibleAccountant, amount, managementFee, performanceFee, refundRatio, amount);
      const totalRefunds = (firstLoss * refundRatio) / MAX_BPS_ACCOUNTANT;
      await createAndCheckLoss(strategy, governance, vault, firstLoss, 0n, totalRefunds);
      await checkPricePerShare(1n);
      expect(await vault.balanceOf(await vault.getAddress())).to.equal(0n);
      await checkVaultTotals(0n, totalRefunds, totalRefunds, amount);
      expect(await vault.balanceOf(await flexibleAccountant.getAddress())).to.equal(0n);
      await expect(
        vault.connect(governance).updateDebt(await strategy.getAddress(), 0n, 0)
      ).to.be.revertedWith("No debt change");
      expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0n);
      await checkPricePerShare(1n);
      await checkVaultTotals(0n, totalRefunds, totalRefunds, amount);
      await vault.connect(alice)["redeem(uint256,address,address)"](await vault.balanceOf(alice.address), alice.address, alice.address);
      await checkPricePerShare(1n);
      await checkVaultTotals(0n, 0n, 0n, 0n);
      expect(await usdc.balanceOf(alice.address)).to.equal(fishAmount / 10n);
    });

    
  });
});
