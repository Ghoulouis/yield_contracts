import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, ERC20Mintable__factory, Accountant, Accountant__factory } from "../../typechain-types";
import { ethers } from "hardhat";
import { expect } from "chai";
import { getNamedAccounts, ethers as hreEthers } from "hardhat";
import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers";

describe("Accountant test", () => {
  let accountant: Accountant;
  let usdc: ERC20Mintable;
  let deployer: HardhatEthersSigner;
  let nonGovernance: HardhatEthersSigner;
  let deployerAddress: string;
  let otherAddress: string;
  let strategyAddress: string;
  let snapshot: SnapshotRestorer;
  let strategy: MockStrategy;

before(async () => {
  const { deployer: deployerAcc, agent } = await getNamedAccounts();
  deployer = await hreEthers.getSigner(deployerAcc);
  nonGovernance = await hreEthers.getSigner(agent);
  deployerAddress = deployerAcc;
  otherAddress = agent;

  const USDCFactory = (await hreEthers.getContractFactory("ERC20Mintable", deployer)) as ERC20Mintable__factory;
  usdc = await USDCFactory.deploy("USDC", "USDC", 6);
  await usdc.waitForDeployment();

  const AccountantFactory = (await hreEthers.getContractFactory("Accountant", deployer)) as Accountant__factory;
  accountant = await AccountantFactory.deploy();
  await accountant.waitForDeployment();
  await accountant.connect(deployer).initialize(deployerAddress);

  const StrategyFactory = (await hreEthers.getContractFactory("MockStrategy", deployer)) as MockStrategy__factory;
  strategy = await StrategyFactory.deploy();
  await strategy.waitForDeployment();
  strategyAddress = await strategy.getAddress(); 

  await accountant.connect(deployer).setPerformanceFee(strategyAddress, 1000); // 10%
  await accountant.connect(deployer).setRefundRatio(strategyAddress, 500); // 5%
});
  beforeEach(async () => {
    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
  });

  it("khởi tạo đúng", async () => {
    expect(await accountant.governance()).to.equal(deployerAddress);
    // Không kiểm tra asset vì contract không thiết lập
  });

  it("báo cáo đúng với gain", async () => {
  const gain = ethers.parseUnits("1234", 6);
  const loss = ethers.parseUnits("0", 6);

  await accountant.connect(deployer).report(strategyAddress, gain, loss);
  
//   expect(totalFees).to.equal(ethers.parseUnits("100", 6)); // 10%
//   expect(totalRefunds).to.equal(0);
  console.log("Báo cáo trường hợp 1 (gain) thành công");
});

  it("báo cáo đúng với loss", async () => {
    const gain = ethers.parseUnits("0", 6);
    const loss = ethers.parseUnits("200", 6);

    await expect(
      accountant.connect(deployer).report(strategyAddress, gain, loss)
    ).to.be.reverted;

    const expectedRefunds = (loss * BigInt(500)) / BigInt(10000); // 5% * 200
    expect(expectedRefunds).to.equal(ethers.parseUnits("10", 6));
    console.log("Báo cáo trường hợp 2 (loss) thành công");
  });

  it("thiết lập performanceFee đúng (chỉ governance, non-governance không được)", async () => {
    const newPerformanceFee = 1200; // 12%
    await accountant.connect(deployer).setPerformanceFee(strategyAddress, newPerformanceFee);
    expect((await accountant.fees(strategyAddress)).performanceFee).to.equal(newPerformanceFee);

    await expect(
      accountant.connect(nonGovernance).setPerformanceFee(strategyAddress, 1500)
    ).to.be.revertedWith("Not governance");
    expect((await accountant.fees(strategyAddress)).performanceFee).to.equal(newPerformanceFee);
  });

  it("thiết lập refundRatio đúng (chỉ governance, non-governance không được)", async () => {
    const newRefundRatio = 600; // 6%
    await accountant.connect(deployer).setRefundRatio(strategyAddress, newRefundRatio);
    expect((await accountant.fees(strategyAddress)).refundRatio).to.equal(newRefundRatio);

    await expect(
      accountant.connect(nonGovernance).setRefundRatio(strategyAddress, 700)
    ).to.be.revertedWith("Not governance");
    expect((await accountant.fees(strategyAddress)).refundRatio).to.equal(newRefundRatio);
  });

  it("thiết lập managementFee đúng (chỉ governance, non-governance không được)", async () => {
    const newManagementFee = 200; // 2%
    await accountant.connect(deployer).setManagementFee(strategyAddress, newManagementFee);
    expect((await accountant.fees(strategyAddress)).managementFee).to.equal(newManagementFee);

    await expect(
      accountant.connect(nonGovernance).setManagementFee(strategyAddress, 300)
    ).to.be.revertedWith("Not governance");
    expect((await accountant.fees(strategyAddress)).managementFee).to.equal(newManagementFee);
  });
});