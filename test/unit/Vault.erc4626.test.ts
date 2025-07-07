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
      await mintAndDeposit(vault, usdc, amount, alice);
      expect(await vault["maxWithdraw(address)"](alice.address)).to.equal(amount);
    });

    it("maxWithdraw() with custom parameters", async () => {
      await mintAndDeposit(vault, usdc, amount, alice);
      await addStrategy(vault, strategy, governance);

      let strategyDeposit = amount / 2n;
      await addDebtToStrategy(vault, strategy, strategyDeposit, governance);

      expect(await vault["maxWithdraw(address,uint256,address[])"](alice.address, 22n, [await strategy.getAddress()])).to.equal(amount);
    });

    it("maxWithdraw() with lossy strategy", async () => {
      let strategyDeposit = amount / 2n;
      let loss = strategyDeposit / 2n;
      let totalIdle = amount - strategyDeposit;
      await mintAndDeposit(vault, usdc, amount, alice);
      await addStrategy(vault, strategy, governance);
      await addDebtToStrategy(vault, strategy, strategyDeposit, governance);
      await setLoss(strategy, loss, governance);

      expect(await vault["maxWithdraw(address)"](alice.address)).to.equal(totalIdle);
      expect(await vault["maxWithdraw(address,uint256,address[])"](alice.address, 10000, [await strategy.getAddress()])).to.equal(amount);
    });
  });
});
