import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  let vault = await get("Vault");

  await deploy("WithdrawLimitModule", {
    contract: "WithdrawLimitModule",
    from: deployer,
    args: [vault.address, deployer],
    log: true,
    autoMine: true,
  });
};
deploy.tags = ["withdraw-limit-module"];
export default deploy;
