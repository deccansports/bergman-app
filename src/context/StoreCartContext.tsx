
"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import type { StoreCartItem } from "@/lib/types";

type CartContextType = {
  cart: StoreCartItem[];
  addToCart: (item: Omit<StoreCartItem, 'quantity'>) => void;
  removeFromCart: (productId: string, size: string) => void;
  updateQty: (productId: string, size: string, qty: number) => void;
  clearCart: () => void;
  totalCount: number;
  subtotal: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<StoreCartItem[]>([]);

  // Load cart from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("bergman_cart");
    if (saved) {
      try {
        setCart(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse cart");
      }
    }
  }, []);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("bergman_cart", JSON.stringify(cart));
  }, [cart]);

  const addToCart = (item: Omit<StoreCartItem, 'quantity'>) => {
    setCart((prev) => {
      const exists = prev.find((p) => p.productId === item.productId && p.size === item.size);
      if (exists) {
        return prev.map((p) =>
          p.productId === item.productId && p.size === item.size
            ? { ...p, quantity: p.quantity + 1 }
            : p
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string, size: string) => {
    setCart((prev) => prev.filter((item) => !(item.productId === productId && item.size === size)));
  };

  const updateQty = (productId: string, size: string, quantity: number) => {
    if (quantity < 1) return;
    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId && item.size === size
          ? { ...item, quantity }
          : item
      )
    );
  };

  const clearCart = () => setCart([]);

  const totalCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const subtotal = cart.reduce((acc, item) => acc + item.salePrice * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{ cart, addToCart, removeFromCart, updateQty, clearCart, totalCount, subtotal }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};
