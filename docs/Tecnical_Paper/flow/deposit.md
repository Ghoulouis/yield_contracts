#### Yêu cầu chức năng

- Người dùng rút tiền khỏi vault bằng cách trả lại lp token
- Vault sẽ trả lại tiền người dùng, ưu tiên tài sản nhàn rỗi trong vault, nếu không đủ sẽ đi rút từng strategy một để trả lại người dùng, nếu rút hết vẫn không đủ thì sẻ revert
- Người dùng có thể cho tuỳ chọn `Loss` là giá trị thâm hụt khi rút tiền từ các strategy khi mà chúng chưa được `report`, giống như slippage vậy.

#### Luồng hoạt động

Gồm 2 phần chính, đầu tiên kiểm tra xem nếu có cài đặt giới hạn `limitModule` thì input phải thoả mãn

```solidity
 if (vault.withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }
```

Sau đó, nếu cơ chế tự động phân bổ được bật, tài sản sẽ được chuyển đến strategy đầu tiên thông qua việc cập nhật nợ cho stragety đầu tiên

```solidity
 if (vault.autoAllocate && vault.defaultQueue.length > 0) {
            vault.ExecuteUpdateDebt(
                vault.defaultQueue[0],
                type(uint256).max,
                0
            );
        }
```
