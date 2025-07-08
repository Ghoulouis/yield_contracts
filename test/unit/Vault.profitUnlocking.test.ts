import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts, network } from "hardhat";
import hre from "hardhat";
import { assert, ethers as ethersv6, MaxUint256, parseEther, parseUnits } from "ethers";
import {
  addDebtToStrategy,
  addStrategy,
  mintAndDeposit,
  processReport,
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
import { increase } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";
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

  async function createAndCheckProfit(profit: bigint) {
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
    expect(parsed?.args!.totalRefunds).to.equal(0);
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

  describe("profitUnlocking", () => {
    let fishAmount = parseUnits("1000", 6);
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

      await vault.connect(alice).redeem(alice.address, alice.address, alice.address, await vault.balanceOf(alice.address), 0, []);
      await checkPricePerShare(2n);
    });
  });
});
