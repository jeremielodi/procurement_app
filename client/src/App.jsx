// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { EnterpriseProvider } from './contexts/EnterpriseContext';
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
import GRNList from './components/GRN/GRNList';
import GRNForm from './components/GRN/GRNForm';
import GRNDetail from './components/GRN/GRNDetail';
import SANList from './components/SAN/SANList';
import SANForm from './components/SAN/SANForm';
import SANDetail from './components/SAN/SANDetail';
import InvoiceList from './components/Invoices/InvoiceList';
import InvoiceForm from './components/Invoices/InvoiceForm';
import InvoiceDetail from './components/Invoices/InvoiceDetail';
import PaymentList from './components/Payments/PaymentList';
import PaymentForm from './components/Payments/PaymentForm';
import PaymentDetail from './components/Payments/PaymentDetail';
import  './app.css'
function App() {
  return (
    <AuthProvider>
      <EnterpriseProvider>
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

        {/* GRN — Bons de réception */}
        <Route path="/goods-receipts" element={<ProtectedRoute><Layout><GRNList /></Layout></ProtectedRoute>} />
        <Route path="/goods-receipts/new" element={<ProtectedRoute><Layout><GRNForm /></Layout></ProtectedRoute>} />
        <Route path="/goods-receipts/:id" element={<ProtectedRoute><Layout><GRNDetail /></Layout></ProtectedRoute>} />

        {/* SAN — Notes d'acceptation de service */}
        <Route path="/service-acceptance-notes" element={<ProtectedRoute><Layout><SANList /></Layout></ProtectedRoute>} />
        <Route path="/service-acceptance-notes/new" element={<ProtectedRoute><Layout><SANForm /></Layout></ProtectedRoute>} />
        <Route path="/service-acceptance-notes/:id" element={<ProtectedRoute><Layout><SANDetail /></Layout></ProtectedRoute>} />

        {/* Factures */}
        <Route path="/invoices" element={<ProtectedRoute><Layout><InvoiceList /></Layout></ProtectedRoute>} />
        <Route path="/invoices/new" element={<ProtectedRoute><Layout><InvoiceForm /></Layout></ProtectedRoute>} />
        <Route path="/invoices/:id" element={<ProtectedRoute><Layout><InvoiceDetail /></Layout></ProtectedRoute>} />

        {/* Paiements */}
        <Route path="/payments" element={<ProtectedRoute><Layout><PaymentList /></Layout></ProtectedRoute>} />
        <Route path="/payments/new" element={<ProtectedRoute><Layout><PaymentForm /></Layout></ProtectedRoute>} />
        <Route path="/payments/:id" element={<ProtectedRoute><Layout><PaymentDetail /></Layout></ProtectedRoute>} />
      </Routes>

      </EnterpriseProvider>
    </AuthProvider>


  );
}

export default App;