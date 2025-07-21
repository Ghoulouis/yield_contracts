import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let usdc = await get("USDC");

  let timeUnlock = 7 * 24 * 60 * 60;

  let maxDepositLogic = await deploy("MaxDepositLogic", {
    from: deployer,
    log: true,
  });

  await deploy("Vault", {
    contract: "Vault",
    from: deployer,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [deployer, usdc.address, "LP Vault", "LP", timeUnlock],
        },
      },
    },
    log: true,
    autoMine: true,
    libraries: {
      MaxDepositLogic: maxDepositLogic.address,
    },
  });
};
deploy.tags = ["vault"];

export default deploy;
