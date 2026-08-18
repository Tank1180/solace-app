import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Paychecks from './pages/Paychecks';
import Transactions from './pages/Transactions';
import Investments from './pages/Investments';
import Bills from './pages/Bills';
import Tax from './pages/Tax';
import OtherIncome from './pages/OtherIncome';
import Profile from './pages/Profile';
import Subscription from './pages/Subscription';
import Business from './pages/Business';
import Admin from './pages/Admin';
import AdminTax from './pages/AdminTax';
import AdminSubscriptions from './pages/AdminSubscriptions';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={(
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            )}
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/paychecks" element={<Paychecks />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/tax" element={<Tax />} />
            <Route path="/other-income" element={<OtherIncome />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/business" element={<Business />} />
            <Route
              path="/admin"
              element={(
                <ProtectedRoute adminOnly>
                  <Admin />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/admin/tax"
              element={(
                <ProtectedRoute adminOnly>
                  <AdminTax />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/admin/subscriptions"
              element={(
                <ProtectedRoute adminOnly>
                  <AdminSubscriptions />
                </ProtectedRoute>
              )}
            />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
