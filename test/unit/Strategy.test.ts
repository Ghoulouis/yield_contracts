import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, OffChainStrategy, OffChainStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts } from "hardhat";
import hre from "hardhat";
import { assert, ethers as ethersv6, parseUnits } from "ethers";
import { expect } from "chai";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";

describe("Base-Offchain Strategy", () => {
    let vault: Vault;
    let usdc: ERC20Mintable;
    let provider = hre.ethers.provider;
    let governance: HardhatEthersSigner;
    let alice: ethersv6.Wallet;
    let bob: ethersv6.Wallet;
    let henry: ethersv6.Wallet;
    let amount = parseUnits("1000", 6);
    let snapshot: SnapshotRestorer;
    let strategy: OffChainStrategy;

    before(async () => {
        await hre.deployments.fixture();
        let { deployer } = await getNamedAccounts();
        governance = await hre.ethers.getSigner(deployer);
        const { get } = hre.deployments;
        usdc = ERC20Mintable__factory.connect((await get("USDC")).address, provider);
        vault = Vault__factory.connect((await get("Vault")).address, governance);
        alice = new ethersv6.Wallet(ethersv6.Wallet.createRandom().privateKey, provider);
        bob = new ethersv6.Wallet(ethersv6.Wallet.createRandom().privateKey, provider);
        henry = new ethersv6.Wallet(ethersv6.Wallet.createRandom().privateKey, provider);
        await governance.sendTransaction({
            to: henry.address,
            value: ethersv6.parseEther("100"),
        });
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

    describe("OffChainStrategy", () => {
        beforeEach(async () => {
            const StrategyFactory = await hre.ethers.getContractFactory("OffChainStrategy", governance);
            strategy = await StrategyFactory.deploy();
            await usdc.connect(governance).mint(governance.address, parseUnits("10000", 6));
            await usdc.connect(governance).approve(strategy.getAddress(), parseUnits("10000", 6));
            await strategy.initialize(
                vault.getAddress(),
                governance.address,
                bob.address,
                usdc.getAddress(),
                "OffChain Strategy",
                "STRAT"
            );
        });

        it("should initialize correctly", async () => {
            console.log("Strategy address:", await strategy.getAddress());
            console.log("Vault address:", await vault.getAddress());
            console.log("Governance address:", governance.address);
            console.log("Agent address:", bob.address);
            console.log("Token address (USDC):", await usdc.getAddress());
            console.log("Name:", await strategy.name());
            console.log("Symbol:", await strategy.symbol());
            expect(await strategy.vault()).to.equal(await vault.getAddress());
            expect(await strategy.governance()).to.equal(governance.address);
            expect(await strategy.agent()).to.equal(bob.address);
            expect(await strategy.name()).to.equal("OffChain Strategy");
            expect(await strategy.symbol()).to.equal("STRAT");
        });

        it("set vault correctly (2 cases)", async () => {
            await strategy.connect(governance).setVault(henry.address);
            expect(await strategy.vault()).to.equal(henry.address);
            await expect(strategy.connect(bob).setVault(henry.address)).to.be.revertedWith("Not governance");
            console.log("Set vault thành công (cả 2 case)");
        });

        it("set Agent correctly", async () => {
            await strategy.connect(governance).setAgent(alice.address);
            expect(await strategy.agent()).to.equal(alice.address);
            await expect(strategy.connect(bob).setAgent(alice.address)).to.be.revertedWith("Not governance");
            console.log("Set agent thành công (cả 2 case)");
        });

        it("get totalAssets correctly", async () => {
            const totalAssets = await strategy.totalAssets();
            console.log("Total assets:", totalAssets.toString());
            expect(totalAssets).to.equal(0n);
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).deposit(amount, alice.address);
            const totalAssetsAfter = await strategy.totalAssets();
            console.log("Total assets after deposit:", totalAssetsAfter.toString());
            expect(totalAssetsAfter).to.equal(amount);
        });


        it("deposit correctly (2 cases)", async () => {
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).deposit(amount, henry.address);
            console.log("Total assets after deposit:", (await strategy.totalAssets()).toString());
            expect(await strategy.totalAssets()).to.equal(amount);
            await expect(strategy.connect(bob).deposit(amount, henry.address)).to.be.revertedWith("Not vault");
        });

        it("mint correctly (2 cases)", async () => {
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).mint(amount, henry.address);
            const shares = await strategy.balanceOf(henry.address);
            console.log("Shares minted:", shares.toString());
            expect(shares).to.equal(amount);
            await expect(strategy.connect(bob).mint(amount, henry.address)).to.be.revertedWith("Not vault");
        });

      

        it("mint: onlyVault", async () => {
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).mint(amount, henry.address);
            expect(await strategy.balanceOf(henry.address)).to.be.gt(0n);
            console.log("Shares minted to Henry:", (await strategy.balanceOf(henry.address)).toString());
        });

        
        it("invest: onlyAgent + state change", async () => {
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).deposit(amount, henry.address);
            const before = await strategy.totalAssets();
            await usdc.connect(governance).mint(strategy.getAddress(), amount);
            await strategy.connect(bob).invest(amount / 2n);
            expect(await strategy.totalAssets()).to.equal(before);
            expect(await strategy.totalIdle()).to.equal(amount / 2n);
            console.log("Total idle after invest:", (await strategy.totalIdle()).toString());
        });

        it("takeProfit: onlyAgent + state change", async () => {
            await strategy.setVault(governance.address);
            await usdc.connect(governance).transfer(strategy.getAddress(), amount);
            await strategy.connect(governance).deposit(amount, henry.address);
            const beforeIdle = await strategy.totalIdle();
            const beforeAssets = await strategy.totalAssets();
            await usdc.connect(governance).mint(strategy.getAddress(), amount / 2n);
            await strategy.connect(bob).takeProfit(amount / 2n);
            expect(await strategy.totalIdle()).to.equal(beforeIdle + amount / 2n);
            expect(await strategy.totalAssets()).to.equal(beforeAssets);
            console.log("Total idle after takeProfit:", (await strategy.totalIdle()).toString());
        });

        it("invest & takeProfit: onlyAgent", async () => {
            await expect(strategy.connect(alice).invest(1)).to.be.revertedWith("Not agent");
            await expect(strategy.connect(alice).takeProfit(1)).to.be.revertedWith("Not agent");
        });

        it("invest should fail with invalid amount", async () => {
            await expect(strategy.connect(bob).invest(0)).to.be.revertedWith("Invalid amount");
        });

        it("takeProfit should fail with invalid amount", async () => {
            await expect(strategy.connect(bob).takeProfit(0)).to.be.revertedWith("Invalid amount");
        });
    });
});
