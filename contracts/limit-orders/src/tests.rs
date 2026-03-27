#![cfg(test)]

use crate::{OrderBook, OrderType, OrderStatus};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

#[test]
fn test_order_book_structure() {
    let env = Env::default();
    
    let order_book = OrderBook {
        pool_id: 1,
        bids: Vec::new(&env),
        asks: Vec::new(&env),
    };
    
    assert_eq!(order_book.pool_id, 1);
    assert_eq!(order_book.bids.len(), 0);
    assert_eq!(order_book.asks.len(), 0);
}

#[test]
fn test_order_type_enum() {
    assert_eq!(OrderType::Buy as u32, 0);
    assert_eq!(OrderType::Sell as u32, 1);
}

#[test]
fn test_order_status_enum() {
    assert_eq!(OrderStatus::Active as u32, 0);
    assert_eq!(OrderStatus::PartiallyFilled as u32, 1);
    assert_eq!(OrderStatus::Filled as u32, 2);
    assert_eq!(OrderStatus::Cancelled as u32, 3);
}
