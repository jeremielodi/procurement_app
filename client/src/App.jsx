// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Login from './components/Auth/Login';
import Profile from './components/Auth/Profile';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
import RequisitionList from './components/Requisitions/RequisitionList';
import RequisitionForm from './components/Requisitions/RequisitionForm';
import RequisitionDetail from './components/Requisitions/RequisitionDetail';
import RequisitionTasks from './components/Requisitions/RequisitionTasks';
import POList from './components/PurchaseOrders/POList';
import PODetail from './components/PurchaseOrders/PODetail';
import SupplierList from './components/Suppliers/SupplierList';
import SupplierForm from './components/Suppliers/SupplierForm';
import SupplierDetail from './components/Suppliers/SupplierDetail';
import UserList from './components/Admin/UserList';
import UserForm from './components/Admin/UserForm';
import DepartmentList from './components/Departments/DepartmentList';
import ProjectList from './components/Projects/ProjectList';
import NotificationList from './components/Notifications/NotificationList';
import ProfileList from './components/Admin/ProfileList';
import BudgetList from './components/Budget/BudgetList';
import TaskList from './components/Task/TaskList';

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Routes publiques */}
        <Route path="/login" element={<Login />} />

        {/* Routes protégées */}
        <Route path="/" element={
          <ProtectedRoute>
            <Navigate to="/dashboard" />
          </ProtectedRoute>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute>
            <Layout>
              <Profile />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/requisitions" element={
          <ProtectedRoute>
            <Layout>
              <RequisitionList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/requisitions/new" element={
          <ProtectedRoute>
            <Layout>
              <RequisitionForm />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/requisitions/:id" element={
          <ProtectedRoute>
            <Layout>
              <RequisitionDetail />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/requisitions/:id/tasks" element={
          <ProtectedRoute>
            <Layout>
              <RequisitionTasks />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/purchase-orders" element={
          <ProtectedRoute>
            <Layout>
              <POList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/purchase-orders/:id" element={
          <ProtectedRoute>
            <Layout>
              <PODetail />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/suppliers" element={
          <ProtectedRoute>
            <Layout>
              <SupplierList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/suppliers/new" element={
          <ProtectedRoute>
            <Layout>
              <SupplierForm />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/suppliers/:id" element={
          <ProtectedRoute>
            <Layout>
              <SupplierDetail />
            </Layout>
          </ProtectedRoute>
        } />

        {/* ROUTES POUR LA GESTION DES UTILISATEURS */}
        <Route path="/users" element={
          <Layout>
            <UserList />
          </Layout>
        } />

        <Route path="/users/new" element={
          <ProtectedRoute requiredPermission="MANAGE_USERS">
            <Layout>
              <UserForm />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/users/:id/edit" element={
          <ProtectedRoute requiredPermission="MANAGE_USERS">
            <Layout>
              <UserForm />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/departments" element={
          <ProtectedRoute requiredPermission="VIEW_DEPARTMENTS">
            <Layout>
              <DepartmentList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/projects" element={
          <ProtectedRoute requiredPermission="VIEW_PROJECTS">
            <Layout>
              <ProjectList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/notifications" element={
          <ProtectedRoute>
            <Layout>
              <NotificationList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/admin/profiles" element={
          <ProtectedRoute requiredPermission="MANAGE_USERS">
            <Layout>
              <ProfileList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/tasks" element={
          <ProtectedRoute>
            <Layout>
              <TaskList />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/budget" element={
          <ProtectedRoute requiredPermission="VIEW_BUDGET">
            <Layout>
              <BudgetList />
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>

    </AuthProvider>


  );
}

export default App;