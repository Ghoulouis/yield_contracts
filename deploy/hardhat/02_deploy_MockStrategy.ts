import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let vault = await get("Vault");

  let usdc = await get("USDC");

  await deploy("MockStrategy", {
    contract: "MockStrategy",
    from: deployer,
    log: true,
    autoMine: true,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [vault.address, deployer, agent, usdc.address, "LP Vault", "LP"],
        },
      },
    },
  });
};
deploy.tags = ["off-chain-strategy"];
export default deploy;
