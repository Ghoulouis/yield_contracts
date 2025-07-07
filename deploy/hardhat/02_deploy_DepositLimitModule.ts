import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  let vault = await get("Vault");

  await deploy("DepositLimitModule", {
    contract: "DepositLimitModule",
    from: deployer,
    args: [vault.address],
    log: true,
    autoMine: true,
  });
};
deploy.tags = ["deposit-limit-module"];
export default deploy;
