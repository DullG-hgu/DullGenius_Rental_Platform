// src/App.js
// 최종 수정일: 2026.02.19 (구조 개편)
// 설명: 라우터 설정 및 전역 Provider 구성 (InfoBar, Home 등은 하위 페이지로 이동)

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

// Contexts
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { GameProvider } from './contexts/GameDataContext'; // [NEW] 데이터 중앙 관리

// Components (Lazy Load)
const Home = lazy(() => import('./pages/Home'));
const CategorySelect = lazy(() => import('./pages/CategorySelect'));
const GameSearch = lazy(() => import('./pages/GameSearch'));
const GameDetail = lazy(() => import('./components/GameDetail'));
const Login = lazy(() => import('./components/Login'));
const Signup = lazy(() => import('./components/Signup'));
const MyPage = lazy(() => import('./components/MyPage'));
const KioskPage = lazy(() => import('./kiosk/KioskPage'));
const Admin = lazy(() => import('./Admin'));
const OrgRental = lazy(() => import('./pages/OrgRental'));

import ProtectedRoute from './components/ProtectedRoute';
import LoginTooltip from './components/LoginTooltip';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import InstallPromptBanner from './components/InstallPromptBanner';

const PasswordReset = lazy(() => import('./components/PasswordReset'));

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <GameProvider>
          <BrowserRouter>
            <InstallPromptBanner />
            <ChunkErrorBoundary>
              <Suspense fallback={
                <div className="loading-container">
                  <div className="spinner"></div>
                  <p style={{ marginTop: "20px", color: "#666" }}>Loading...</p>
                </div>
              }>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/categories" element={<CategorySelect />} />
                  <Route path="/search" element={<GameSearch />} />

                  <Route path="/game/:id" element={<GameDetail />} />
                  <Route path="/mypage" element={<MyPage />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/reset-password" element={<PasswordReset />} />

                  <Route element={<ProtectedRoute allowedRoles={['admin', 'executive']} />}>
                    <Route path="/admin-secret" element={<Admin />} />
                  </Route>

                  <Route path="/org-rental" element={<OrgRental />} />
                  <Route path="/kiosk" element={<KioskPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ChunkErrorBoundary>
          </BrowserRouter>
        </GameProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
