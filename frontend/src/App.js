import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CartProvider } from "./contexts/CartContext";

import Home from "./pages/Home";
import CategoryPage from "./pages/CategoryPage";
import ProductDetail from "./pages/ProductDetail";
import StoreList from "./pages/StoreList";
import StorePage from "./pages/StorePage";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import OrderTracking from "./pages/OrderTracking";
import ReturnTracking from "./pages/ReturnTracking";
import CustomerAccount from "./pages/CustomerAccount";
import SearchPage from "./pages/SearchPage";
import CategoryHub from "./pages/CategoryHub";
import WishlistPage from "./pages/WishlistPage";
import LocationGate from "./components/consumer/LocationGate";

import MerchantAuth from "./pages/MerchantAuth";
import MerchantOnboardingStatus from "./pages/MerchantOnboardingStatus";
import MerchantKyc from "./pages/MerchantKyc";
import MerchantStorefront from "./pages/MerchantStorefront";
import MerchantProducts from "./pages/MerchantProducts";
import MerchantAnalytics from "./pages/MerchantAnalytics";
import MerchantOrders from "./pages/MerchantOrders";
import MerchantBank from "./pages/MerchantBank";
import AIStudio from "./pages/AIStudio";

import AdminLogin, { AdminDashboard } from "./pages/AdminPanel";
import StickyBottomNav from "./components/consumer/v2/StickyBottomNav";
import StickyCart from "./components/consumer/v2/StickyCart";

function Protected({ children }) {
  const { merchant, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#595959]">Loading…</div>;
  if (!merchant) return <Navigate to="/merchant/login" replace />;
  return children;
}
function ApprovedOnly({ children }) {
  const { merchant, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#595959]">Loading…</div>;
  if (!merchant) return <Navigate to="/merchant/login" replace />;
  if (merchant.kyc_status !== "approved") return <Navigate to="/merchant/onboarding" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <Toaster position="top-center" richColors />
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <LocationGate />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/categories" element={<CategoryHub />} />
              <Route path="/wishlist" element={<WishlistPage />} />
              <Route path="/c/:slug" element={<CategoryPage />} />
              <Route path="/c/:slug/:l2slug" element={<CategoryPage />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/p/:id" element={<ProductDetail />} />
              <Route path="/stores" element={<StoreList />} />
              <Route path="/store/:id" element={<StorePage />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/orders/:id" element={<OrderTracking />} />
              <Route path="/returns/:id" element={<ReturnTracking />} />
              <Route path="/account" element={<CustomerAccount />} />
              <Route path="/search" element={<SearchPage />} />

              <Route path="/merchant/login" element={<MerchantAuth mode="login" />} />
              <Route path="/merchant/register" element={<MerchantAuth mode="register" />} />
              <Route path="/merchant/onboarding" element={<Protected><MerchantOnboardingStatus /></Protected>} />
              <Route path="/merchant/kyc" element={<Protected><MerchantKyc /></Protected>} />
              <Route path="/merchant/dashboard" element={<Protected><MerchantOnboardingStatus /></Protected>} />
              <Route path="/merchant/orders" element={<ApprovedOnly><MerchantOrders /></ApprovedOnly>} />
              <Route path="/merchant/storefront" element={<ApprovedOnly><MerchantStorefront /></ApprovedOnly>} />
              <Route path="/merchant/bank" element={<ApprovedOnly><MerchantBank /></ApprovedOnly>} />
              <Route path="/merchant/products" element={<ApprovedOnly><MerchantProducts /></ApprovedOnly>} />
              <Route path="/merchant/ai-studio" element={<ApprovedOnly><AIStudio /></ApprovedOnly>} />
              <Route path="/merchant/analytics" element={<ApprovedOnly><MerchantAnalytics /></ApprovedOnly>} />

              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
            <StickyCart />
            <StickyBottomNav />
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </div>
  );
}
export default App;
