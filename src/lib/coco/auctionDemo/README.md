# Coco Auction demo boundary

This directory is a controlled, local-only integration harness for the frozen Coco candidate. It is not a production wallet architecture.

The `FrozenCocoAuctionWallet` adapter owns a demo-only seed because Coco's host API requires stable wallet seed material across browser restarts. The seed is stored in a dedicated IndexedDB database private to that adapter. Auction UI, workflow-control, and protocol modules receive neither the seed nor a seed-reading API. The seed is never logged or copied into the Market workflow-control database.

The workflow-control database contains only non-bearer business state and signed public protocol events. Production use would require a separately reviewed secret host/vault and multi-runtime ownership/fencing design.

For the Friday single-browser-origin demo, each monetary leg uses an exact-identity Web Lock across durable claim/recovery, full Coco operation reconciliation, optional prepare, and durable operation binding. The durable claim never transfers through the ordinary claim path; a page that obtains the Web Lock after a crash uses an explicit recovery transition. This browser-origin fence is demo coordination only and is not the production wallet OWNER/FENCE design.
