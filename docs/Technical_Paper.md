<h1> OmniFarming V2 Technical Paper </h1>

_A solidity forked from [Yearn V3](https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy)_

- [Overview](#overview)
- [Architecture](#architecture)
- [Mechanism](#mechanism)

  - [Strategies Mechanism](#strategies-mechanism)
  - [Auto Allocate Mechanism](#auto-allocate-mechanism)
  - [Reward Mechanism](#reward-mechanism)
  - [Fee Mechanism](#fee-mechanism)
  - [Limit Mechanism](#limit-mechanism)
  - [Unrealised Losses Mechanism](#unrealised-losses-mechanism)
  - [Buy Debt Mechanism](#buy-debt-mechanism)

- [Functions](#function)
  - [Deposit](#deposit)
  - [Withdraw](#withdraw)
  - [Report](#report)

# Overview

OmniFarming V2 is a yield optimization protocol that extends the Yearn V3 vault architecture. It allows users to deposit assets into a vault, which are then allocated to various strategies to maximize returns. Key features include automated fund allocation, performance-based fees, and mechanisms to handle unrealized losses

# Architecture

OmniFarming V2 comprises three main components:

- **Vault.sol**: Manages user deposits, withdrawals, and strategy allocations, follow ERC4626..
- **Strategies**: External contracts that invest vault assets to generate profits, follow ERC4626.
- **Accountant.sol**: Calculates and distributes performance fees and refunds.

# Mechanism

### Strategies Mechanism

- Mô tả chức năng strategies: thêm, xoá strategy, quản lí nợ, cập nhật max nợ
- Giải thích chức năng của Queue trong cơ chế này

Coming soon

### Auto Allocate Mechanism

Coming soon

### Reward Mechanism

Cơ chế trả phần trưởng trong OmniFarming V2 khá đặc biệt, 1 strategy khi tích hợp có thể mang lại lãi hoặc lỗ tuỳ thời điểm được báo cáo.

- Trường hợp lãi, lãi sẽ được vesting dần thông qua đường cong dựa trên `profitMaxUnlockTime` theo đơn vị giây

- Trường hợp lỗ, vault sẽ cập nhật tổn thất ngay lập tức, trước tiên là giảm lợi nhuận đang vesting từ báo cáo trước đó, sau đó là giảm pps.

### Fee Mechanism

OmniFarming V2 thu 2 loại phí, bao gồm:

- Management Fee: 1% 1 năm trên fund
- Performance Fee: 10% trên profit

**Management Fee**

Mint lượng lp tương ứng giữa 2 lần deposit/withdraw dựa trên **tổng số thanh khoản của user**,
Override các hàm `PreviewMint` `PreviewWithdraw` `PreviewDeposit` `PreviewRedeem` theo công thức mới có tính trước management Fee vào totalSupply

**Performance Fee**

Thu phí thông qua `Accountant` trong hàm `ExecuteProcessReport`

Khi một strategy được báo cáo, `Accountant` sẽ tính `performanceFee` và `refund`

- `PerformanceFee`: Fee thu dựa trên lợi nhuận (yêu cầu business 10%), fee này sẽ được chuyển đổi thành lượng liquidity và mint chúng dưới dạng thanh khoản cho `Accountant`

- `refund`: (Forked yearn v3) giá trị trả lại mỗi khi 1 strategy được báo cáo (có thể sử dụng để làm reward boost apy hoặc bù lỗ)

### Limit Mechanism

Vault có các cơ chế giới hạn số dư của người dùng bằng cách đặt các giới hạn tại hàm `deposit` và `withdraw` thông qua 2 cơ chế chính là `depositLimit` của Vault hoặc nâng cao hơn `depositLimitModule` và `withdrawLimitModule`

- `DepositLimit`: Giới hạn tvl của Vault, cập nhật thông qua hàm `setLimitDeposit`
- `depositLimitModule`: Contract kiểm tra nâng cao với input thêm địa chỉ user, có thể dùng đề giới hạn tài sản của riêng từng user
- `withdrawLimitModule`: Tương tự với depositLimitModue, thêm điều kiện kiểm tra nâng cao khi withdraw

### Unrealised Losses Mechanism

UnrealisedLosses là cơ chế tính tổn thất tạm thời (lỗ chưa được báo cáo), là phần quan trọng để bảo vệ người rút tiền sau không phải "ôm lỗ" cho người rút trước.

### Buy Debt Mechanism

Buy Debt là cơ chế cho phép những người có thẩm quyền có thể mua lại nợ của Vault

- Chỉ những người có ROLE `ROLE_DEBT_PURCHASER` có thể mua nợ
- ROLE được cấp bởi GORVERNANCE

### Minimum Total Idle

Minimum total Idle là chức năng giữ 1 lượng tiền tối thiểu trong vault để làm thanh khoản, chúng có chức năng

- Thanh khoản rút tiền nhành
- Tránh force-withdraw từ strategy gây tổn thất
- Được đặt và cập nhật bởi `ROLE_MINIMUM_IDLE_MANAGER`

# Function

### Deposit

#### Yêu cầu chức năng

- Người dùng gửi tài sản và nhận lại LP tương ứng
- Nếu cơ chế tự động phân bổ vào strategy đầu tiên được bật thì tài sản sẽ tự động phân bổ vào strategy đầu tiên

### Withdraw

### Yêu cầu chức năng

- Người dùng rút tài sản bằng cách burn lượng LP tương ứng
- Kho tiền ưu tiên lượng tài sản rảnh rỗi trong vault, nếu không đủ sẽ rút phần thiếu từ các strategy
- Khi rút tiền sớm từ strategy sẽ có khả năng lỗ ( do strategy có thể lỗ), vì thế người dùng có thể nhập 1 giá trị `loss` hoạt động tương tự như slippage có thể châp nhận số tiền lỗ trong khả năng cho phép
- Cho phép B rút tiền từ lp của A nếu đã được approve lượng lp

### Report

Yêu cầu chức năng

- Tính toán lời, lỗ giữa 2 lần báo cáo
- Gọi tới `Accountant` để tính toán performanceFees hoặc refund
- Tính toán lại totalSupply theo tuỳ chon lời lỗ
  - nếu lời: mint thêm LP, lock vào địa chỉ vault và burn dần thông qua hàm `unlockShares()`
  - nếu lỗ: đầu tiên bù lỗ bằng cách giảm reward của lần báo cáo trước đó, nếu sau đó vẫn còn lỗ thì giảm PPS (cập nhật totalDebt)

```solidity
uint256 totalSupply = vault.totalSupply() + lockedShares;
uint256 endingSupply = totalSupply - lockedShares + sharesToLock - sharesToBurn;

if (endingSupply > totalSupply) {
      vault._mint(address(this), endingSupply - totalSupply);
  }
if (totalSupply > endingSupply) {
    uint256 toBurn = Math.min(totalSupply - endingSupply,totalLockedShares);
    vault._burn(address(this), toBurn);
}
```
