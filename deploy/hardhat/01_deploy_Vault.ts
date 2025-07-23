import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let usdc = await get("USDC");
  let timeUnlock = 7 * 24 * 60 * 60;
  let ERC20LogicDeployment = await deploy("ERC20Logic", {
    from: deployer,
    log: true,
  });

  let ERC4626LogicDeployment = await deploy("ERC4626Logic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
    },
  });

  let DepositLogicDeployment = await deploy("DepositLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
    },
  });

  let WithdrawLogicDeployment = await deploy("WithdrawLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
    },
  });

  let UnlockSharesLogicDeployment = await deploy("UnlockSharesLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
    },
  });

  let InitializeLogicDeployment = await deploy("InitializeLogic", {
    from: deployer,
    log: true,
  });

  let ConfiguratorLogicDeployment = await deploy("ConfiguratorLogic", {
    from: deployer,
    log: true,
  });

  let DebtLogicDeployment = await deploy("DebtLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
      UnlockSharesLogic: UnlockSharesLogicDeployment.address,
    },
  });

  await deploy("Vault", {
    contract: "Vault",
    from: deployer,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [usdc.address, "LP Vault", "LP", timeUnlock, deployer],
        },
      },
    },
    log: true,
    autoMine: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
      InitializeLogic: InitializeLogicDeployment.address,
      DepositLogic: DepositLogicDeployment.address,
      WithdrawLogic: WithdrawLogicDeployment.address,
      UnlockSharesLogic: UnlockSharesLogicDeployment.address,
      DebtLogic: DebtLogicDeployment.address,
      ConfiguratorLogic: ConfiguratorLogicDeployment.address,
    },
  });
};
deploy.tags = ["vault"];

export default deploy;
