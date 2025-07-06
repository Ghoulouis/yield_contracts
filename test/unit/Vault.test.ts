import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { ethers as ethersv6, MaxUint256 } from "ethers";
import { mint, mintAndDeposit, setDepositLimit } from "../helper";
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

  before(async () => {
    await hre.deployments.fixture();
    let { deployer, agent, beneficiary } = await getNamedAccounts();
    governance = await hre.ethers.getSigner(deployer);
    const { get } = hre.deployments;
    usdc = ERC20Mintable__factory.connect((await get("USDC")).address, provider);
    vault = Vault__factory.connect((await get("Vault")).address, governance);
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

    it("maxDeposit with depositLimit", async () => {
      let amount = 10n ** 6n;
      await setDepositLimit(vault, amount, governance);
      expect(await vault.maxDeposit(alice.address)).to.equal(amount);
    });
  });
});
