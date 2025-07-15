import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Accountant, Accountant__factory, ERC20Mintable, ERC20Mintable__factory, MockStrategy, MockStrategy__factory, Vault, Vault__factory } from "../../typechain-types";
import { getNamedAccounts, network } from "hardhat";
import hre from "hardhat";
import { AbiCoder, assert, ethers as ethersv6, getAccountPath, parseUnits } from "ethers";
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
} from "../helper";

describe("Vault auto_allocate Tests", () => {
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
    describe("auto_update", () => {
        it("test_deposit__auto_update_debt", async () => {
            const assets = amount / 10n;
            await addStrategy(vault, strategy, governance);
            expect(await vault.autoAllocate()).to.be.false;
            await (await vault.connect(governance).setAutoAllocate(true)).wait();
            expect(await vault.autoAllocate()).to.be.true;
            await (await vault.connect(governance).updateMaxDebtForStrategy(strategy.getAddress(), assets * 2n)).wait();
            expect(await strategy.maxDeposit(vault.getAddress())).to.be.greaterThan(assets);
            expect((await vault.strategies(strategy.getAddress())).maxDebt).to.be.greaterThan(assets);
            expect(await vault.minimumTotalIdle()).to.equal(0);
            /*Para ban dau = 0*/
            expect(await vault.totalAssets()).to.equal(0);
            expect(await vault.totalIdle()).to.equal(0);
            expect(await vault.totalDebt()).to.equal(0);
            expect(await strategy.totalAssets()).to.equal(0);
            expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0);
            expect((await vault.strategies(strategy.getAddress())).currentDebt).to.equal(0);
            expect(await vault.balanceOf(alice.address)).to.equal(0);
            console.log("Begining para: OK");
            const tx = await mintAndDeposit(vault, usdc, assets, alice);
            const receipt = await tx.wait();
            // find event
            const event = receipt.logs
                .map((log) => {
                    try {
                        return vault.interface.parseLog(log);
                    } catch (_) {
                        return null;
                    }
                })
                .filter((log) => log && log.name === "DebtUpdated")[0];
            expect(event).to.exist;
            expect(event!.args.strategy).to.equal(await strategy.getAddress());
            expect(event!.args.currentDebt).to.equal(0);
            expect(event!.args.newDebt).to.equal(assets);
            console.log("Deposit + Event: OK");
            expect(await vault.totalAssets()).to.equal(assets);
            expect(await vault.totalIdle()).to.equal(0);
            expect(await vault.totalDebt()).to.equal(assets);
            expect(await strategy.totalAssets()).to.equal(assets);
            expect(await strategy.balanceOf(await vault.getAddress())).to.equal(assets);
            expect((await vault.strategies(strategy.getAddress())).currentDebt).to.equal(assets);
            const expectedShares = await vault.convertToShares(assets);
            expect(await vault.balanceOf(alice.address)).to.equal(expectedShares);
            console.log("Para after deposit: OK");

        });
        it("test_mint__auto_update_debt", async () => {
            const assets1 = 1_000_000n; // 1 USDC (Alice)
            const assets2 = 10_000_000n; // 10 USDC (Bob) 

            await addStrategy(vault, strategy, governance);

            expect(await vault.autoAllocate()).to.be.false;
            await (await vault.connect(governance).setAutoAllocate(true)).wait();
            expect(await vault.autoAllocate()).to.be.true;
            await (await vault.connect(governance).updateMaxDebtForStrategy(strategy.getAddress(), assets1 * 2n)).wait();

            expect(await strategy.maxDeposit(vault.getAddress())).to.be.greaterThan(assets1);
            expect((await vault.strategies(strategy.getAddress())).maxDebt).to.be.greaterThan(assets1);
            expect(await vault.minimumTotalIdle()).to.equal(0);

            expect(await vault.totalAssets()).to.equal(0);
            expect(await vault.totalIdle()).to.equal(0);
            expect(await vault.totalDebt()).to.equal(0);
            expect(await strategy.totalAssets()).to.equal(0);
            expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0);
            expect((await vault.strategies(strategy.getAddress())).currentDebt).to.equal(0);
            expect(await vault.balanceOf(alice.address)).to.equal(0);

            console.log("Begining para: OK");
            await mintAndDeposit(vault, usdc, assets2, bob);
            console.log("Deposit Bob: OK")
            // const totalAssets = await vault.totalAssets();
            // const totalSupply = await vault.totalSupply();

            await usdc.connect(alice).mint(alice.address, assets1);
            await usdc.connect(alice).approve(await vault.getAddress(), assets1);

            const shares = await vault.convertToShares(assets1);
            console.log("Alice shares after:", shares); //  > 0

            expect(shares).to.be.greaterThan(0n);
            // ko co ham mint dc goi external nen test tam convertToShares
        });

        it("test_deposit__auto_update_debt__max_debt", async () => {
            const assets = 10_000_000n; // 10 USDC
            const maxDebt = assets / 10n; 
            await addStrategy(vault, strategy, governance);
            expect(await vault.autoAllocate()).to.be.false;
            await vault.connect(governance).setAutoAllocate(true);
            expect(await vault.autoAllocate()).to.be.true;
            await vault.connect(governance).updateMaxDebtForStrategy(await strategy.getAddress(), maxDebt);
            await setMaxDebt(strategy, maxDebt, governance);
            expect(await strategy.maxDeposit(await vault.getAddress())).to.equal(maxDebt, "maxDeposit should equal maxDebt");
            expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(maxDebt, "vault maxDebt should equal maxDebt");
            expect(await vault.minimumTotalIdle()).to.equal(0, "minimumTotalIdle should be 0");
            expect(await vault.totalAssets()).to.equal(0, "totalAssets should be 0");
            expect(await vault.totalIdle()).to.equal(0, "totalIdle should be 0");
            expect(await vault.totalDebt()).to.equal(0, "totalDebt should be 0");
            expect(await strategy.totalAssets()).to.equal(0, "strategy totalAssets should be 0");
            expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0, "strategy balanceOf vault should be 0");
            expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0, "currentDebt should be 0");
            expect(await vault.balanceOf(alice.address)).to.equal(0, "alice balance should be 0");

            const tx = await mintAndDeposit(vault, usdc, assets, alice);
            const receipt = await tx.wait();
              const event = receipt.logs
                .map((log) => {
                    try {
                        return vault.interface.parseLog(log);
                    } catch (_) {
                        return null;
                    }
                })
                .filter((log) => log && log.name === "DebtUpdated")[0];
            expect(event).to.exist;
            expect(event!.args.strategy).to.equal(await strategy.getAddress());
            expect(event!.args.currentDebt).to.equal(0);
            expect(event!.args.newDebt).to.equal(maxDebt);
            expect(await vault.totalAssets()).to.equal(assets, "totalAssets should equal assets");
            expect(await vault.totalIdle()).to.equal(assets - maxDebt, "totalIdle should equal assets - maxDebt");
            expect(await vault.totalDebt()).to.equal(maxDebt, "totalDebt should equal maxDebt");
            expect(await strategy.totalAssets()).to.equal(maxDebt, "strategy totalAssets should equal maxDebt");
            expect(await strategy.balanceOf(await vault.getAddress())).to.equal(maxDebt, "strategy balanceOf vault should equal maxDebt");
            expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(maxDebt, "currentDebt should equal maxDebt");
            expect(await vault.balanceOf(alice.address)).to.equal(assets * BigInt(1e12), "alice balance should equal assets");
        });
        it("test_deposit__auto_update_debt__max_deposit_zero", async () => {
            const assets = 1_000_000n; // 1 USDC
            const maxDeposit = 0n;
            await addStrategy(vault, strategy, governance);
            expect(await vault.autoAllocate()).to.be.false;
            await vault.connect(governance).setAutoAllocate(true);
            expect(await vault.autoAllocate()).to.be.true;
            await vault.connect(governance).updateMaxDebtForStrategy(strategy.getAddress(), 2n ** 256n - 1n);
            await setMaxDebt(strategy, maxDeposit, governance);
            expect(await strategy.maxDeposit(vault.getAddress())).to.equal(
                // maxDeposit
                2n ** 256n - 1n);
            expect((await vault.strategies(strategy.getAddress())).maxDebt).to.be.greaterThan(assets);
            expect(await vault.minimumTotalIdle()).to.equal(0);
            expect(await vault.totalAssets()).to.equal(0);
            expect(await vault.totalIdle()).to.equal(0);
            expect(await vault.totalDebt()).to.equal(0);
            expect(await strategy.totalAssets()).to.equal(0);
            expect(await strategy.balanceOf(vault.getAddress())).to.equal(0);
            expect((await vault.strategies(strategy.getAddress())).currentDebt).to.equal(0);
            expect(await vault.balanceOf(alice.address)).to.equal(0);

            const tx = await mintAndDeposit(vault, usdc, assets, alice);

            const receipt = await tx.wait();
            const debtUpdatedLogs = receipt.logs.filter(
                log =>
                    log.address === vault.address &&
                    log.topics[0] === vault.interface.getEventTopic("DebtUpdated")
            );
            expect(debtUpdatedLogs.length).to.equal(0); // Không có DebtUpdated vì maxDeposit = 0

            // after deposit

            console.log("vault totalasset:", await vault.totalAssets()); //1000000n
            console.log(" total idle: ", await vault.totalIdle()); //0n
            console.log("strategy (vault) totalAssets: ", await strategy.balanceOf(vault.getAddress())); //1000000n
            console.log(" vault balance of alice:", await vault.balanceOf(alice.address)); // 1000000000000000000n
            console.log("vault strategy current debt: ", (await vault.strategies(strategy.getAddress())).currentDebt) //1000000n
            console.log("max deposit strategy(governance): ", await strategy.maxDeposit(governance)); // = 2**256 -1 
        });
    });
  it("test_deposit__auto_update_debt__min_idle", async () => {
    const assets = 10_000_000n; // 10 USDC
    const minIdle = assets / 10n; // min_idle = assets // 10

    await addStrategy(vault, strategy, governance);
    expect(await vault.autoAllocate()).to.be.false;

    await vault.connect(governance).setAutoAllocate(true);
    expect(await vault.autoAllocate()).to.be.true;
    await vault.connect(governance).updateMaxDebtForStrategy(await strategy.getAddress(), 2n ** 256n - 1n);
    await setMaxDebt(strategy, 2n ** 256n - 1n, governance);
    await setMinimumTotalIdle(vault, minIdle, governance);
    expect(await strategy.maxDeposit(await vault.getAddress())).to.equal(2n ** 256n - 1n, "maxDeposit should be max uint256");
    expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(2n ** 256n - 1n, "vault maxDebt should be max uint256");
    expect(await vault.minimumTotalIdle()).to.equal(minIdle, "minimumTotalIdle should equal minIdle");
    expect(await vault.totalAssets()).to.equal(0, "totalAssets should be 0");
    expect(await vault.totalIdle()).to.equal(0, "totalIdle should be 0");
    expect(await vault.totalDebt()).to.equal(0, "totalDebt should be 0");
    expect(await strategy.totalAssets()).to.equal(0, "strategy totalAssets should be 0");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0, "strategy balanceOf vault should be 0");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0, "currentDebt should be 0");
    expect(await vault.balanceOf(alice.address)).to.equal(0, "alice balance should be 0");
    const tx = await mintAndDeposit(vault, usdc, assets, alice);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((log) => log && log.name === "DebtUpdated")[0];
    expect(event).to.exist;
    expect(event!.args.strategy).to.equal(await strategy.getAddress(), "Event strategy should match");
    expect(event!.args.currentDebt).to.equal(0, "Event currentDebt should be 0");
    expect(event!.args.newDebt).to.equal(assets - minIdle, "Event newDebt should equal assets - minIdle");

    expect(await vault.totalAssets()).to.equal(assets, "totalAssets should equal assets");
    expect(await vault.totalIdle()).to.equal(minIdle, "totalIdle should equal minIdle");
    expect(await vault.totalDebt()).to.equal(assets - minIdle, "totalDebt should equal assets - minIdle");
    expect(await strategy.totalAssets()).to.equal(assets - minIdle, "strategy totalAssets should equal assets - minIdle");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(assets - minIdle, "strategy balanceOf vault should equal assets - minIdle");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(assets - minIdle, "currentDebt should equal assets - minIdle");
    expect(await vault.balanceOf(alice.address)).to.equal(assets * BigInt(1e12), "alice balance should equal assets");
  });
it("test_deposit__auto_update_debt__min_idle_not_met", async () => {
    const assets = 10_000_000n; // 10 USDC
    const minIdle = assets * 2n; // min_idle = assets * 2
    await addStrategy(vault, strategy, governance);
    expect(await vault.autoAllocate()).to.be.false;
    await vault.connect(governance).setAutoAllocate(true);
    expect(await vault.autoAllocate()).to.be.true;
    await vault.connect(governance).updateMaxDebtForStrategy(await strategy.getAddress(), 2n ** 256n - 1n);
    await setMaxDebt(strategy, 2n ** 256n - 1n, governance);
    await setMinimumTotalIdle(vault, minIdle, governance);
    expect(await strategy.maxDeposit(await vault.getAddress())).to.equal(2n ** 256n - 1n, "maxDeposit should be max uint256");
    expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(2n ** 256n - 1n, "vault maxDebt should be max uint256");
    expect(await vault.minimumTotalIdle()).to.equal(minIdle, "minimumTotalIdle should equal minIdle");
    expect(await vault.totalAssets()).to.equal(0, "totalAssets should be 0");
    expect(await vault.totalIdle()).to.equal(0, "totalIdle should be 0");
    expect(await vault.totalDebt()).to.equal(0, "totalDebt should be 0");
    expect(await strategy.totalAssets()).to.equal(0, "strategy totalAssets should be 0");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0, "strategy balanceOf vault should be 0");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0, "currentDebt should be 0");
    expect(await vault.balanceOf(alice.address)).to.equal(0, "alice balance should be 0");

    const tx = await mintAndDeposit(vault, usdc, assets, alice);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((log) => log && log.name === "DebtUpdated");
    expect(event.length).to.equal(0, "No DebtUpdated event should be emitted");
    expect(await vault.totalAssets()).to.equal(assets, "totalAssets should equal assets");
    expect(await vault.totalIdle()).to.equal(assets, "totalIdle should equal assets");
    expect(await vault.totalDebt()).to.equal(0, "totalDebt should be 0");
    expect(await strategy.totalAssets()).to.equal(0, "strategy totalAssets should be 0");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0, "strategy balanceOf vault should be 0");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0, "currentDebt should be 0");
    expect(await vault.balanceOf(alice.address)).to.equal(assets * BigInt(1e12), "alice balance should equal assets");
  });
  it("test_deposit__auto_update_debt__current_debt_more_than_max_debt", async () => {
    const assets = 5_000_000n; //
    const maxDebt = assets; // max_debt = assets
    await addStrategy(vault, strategy, governance);
    expect(await vault.autoAllocate()).to.be.false;
    await vault.connect(governance).setAutoAllocate(true);
    expect(await vault.autoAllocate()).to.be.true;
    await vault.connect(governance).updateMaxDebtForStrategy(await strategy.getAddress(), maxDebt);
    await setMaxDebt(strategy, maxDebt, governance);

    // Part 1: check
    expect(await strategy.maxDeposit(await vault.getAddress())).to.equal(maxDebt, "maxDeposit should equal maxDebt");
    expect((await vault.strategies(await strategy.getAddress())).maxDebt).to.equal(maxDebt, "vault maxDebt should equal maxDebt");
    expect(await vault.minimumTotalIdle()).to.equal(0, "minimumTotalIdle should be 0");
    expect(await vault.totalAssets()).to.equal(0, "totalAssets should be 0");
    expect(await vault.totalIdle()).to.equal(0, "totalIdle should be 0");
    expect(await vault.totalDebt()).to.equal(0, "totalDebt should be 0");
    expect(await strategy.totalAssets()).to.equal(0, "strategy totalAssets should be 0");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(0, "strategy balanceOf vault should be 0");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(0, "currentDebt should be 0");
    expect(await vault.balanceOf(alice.address)).to.equal(0, "alice balance should be 0");
    const tx1 = await mintAndDeposit(vault, usdc, assets, alice);
    const receipt1 = await tx1.wait();

    const event1 = receipt1.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((log) => log && log.name === "DebtUpdated")[0];
    expect(event1).to.exist;
    expect(event1!.args.strategy).to.equal(await strategy.getAddress(), "Event strategy should match");
    expect(event1!.args.currentDebt).to.equal(0, "Event currentDebt should be 0");
    expect(event1!.args.newDebt).to.equal(maxDebt, "Event newDebt should equal maxDebt");
    expect(await vault.totalAssets()).to.equal(assets, "totalAssets should equal assets");
    expect(await vault.totalIdle()).to.equal(0, "totalIdle should be 0");
    expect(await vault.totalDebt()).to.equal(maxDebt, "totalDebt should equal maxDebt");
    expect(await strategy.totalAssets()).to.equal(maxDebt, "strategy totalAssets should be maxDebt");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(maxDebt, "strategy balanceOf vault should be maxDebt");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(maxDebt, "currentDebt should be maxDebt");
    expect(await vault.balanceOf(alice.address)).to.equal(assets * BigInt(1e12), "alice balance should equal assets");

    const profit = assets / 10n; // profit = assets // 10
    await airdropAsset(usdc, await strategy.getAddress(), profit, governance);
    await strategy.connect(governance).harvest();
    await processReport(vault, strategy, governance);
    
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.be.greaterThan(maxDebt, "currentDebt should be greater than maxDebt");
    console.log("Part 1: OK!");
    const tx2 = await mintAndDeposit(vault, usdc, assets, alice); 
    const receipt2 = await tx2.wait();
    const event2 = receipt2.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .filter((log) => log && log.name === "DebtUpdated");
    expect(event2.length).to.equal(0, "No DebtUpdated event should be emitted");

    expect(await vault.totalAssets()).to.equal(assets * 2n + profit, "totalAssets should equal assets * 2 + profit");
    expect(await vault.totalIdle()).to.equal(assets, "totalIdle should equal assets");
    expect(await vault.totalDebt()).to.equal(maxDebt + profit, "totalDebt should equal maxDebt + profit");
    expect(await strategy.totalAssets()).to.equal(maxDebt + profit, "strategy totalAssets should be maxDebt + profit");
    expect(await strategy.balanceOf(await vault.getAddress())).to.equal(maxDebt, "strategy balanceOf vault should be maxDebt");
    expect((await vault.strategies(await strategy.getAddress())).currentDebt).to.equal(maxDebt + profit, "currentDebt should be maxDebt + profit");
    expect(await vault.balanceOf(alice.address)).to.be.greaterThan(assets * BigInt(1e12), "alice balance should be greater than assets");
    console.log("Part 2: OK!");
  });
});

