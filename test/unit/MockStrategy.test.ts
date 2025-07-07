import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { ethers as ethersv6, MaxUint256, parseUnits } from "ethers";
import { addDebtToStrategy, addStrategy, mintAndDeposit, setDepositLimit, setDepositLimitModule, setLoss, updateDebt, updateMaxDebt } from "../helper";
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
    it("Deposit()", async () => {
      let amount = parseUnits("1000", 6);
      await mintAndDeposit(vault, usdc, amount, alice);
      let totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(amount);
      await addStrategy(vault, strategy, governance);

      console.log("expectedShares = ", await strategy.previewDeposit(amount));
      console.log("preview mint = ", await strategy.previewMint(amount));
      await addDebtToStrategy(vault, strategy, amount, governance);
      console.log(" vault address", await vault.getAddress());
      let lp = await strategy.balanceOf(await vault.getAddress());
      console.log("lp =", lp);
      console.log("totalAssets =", await strategy.totalAssets());
      console.log("totalSupply =", await strategy.totalSupply());
      console.log("convertToAssets =", await strategy.convertToAssets(lp));
    });
  });
});
