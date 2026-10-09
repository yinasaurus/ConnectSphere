import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Events from './pages/Events';
import NewEvent from './pages/NewEvent';
import Drafts from './pages/Drafts';
import EventDetail from './pages/EventDetail';
import UnassignedQueue from './pages/UnassignedQueue';
import VenueBooking from './pages/VenueBooking';
import CalendarPage from './pages/CalendarPage';
import Venues from './pages/Venues';
import VenueAvailability from './pages/VenueAvailability';
import Equipment from './pages/Equipment';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import { ROLES } from './constants';

const requestRoles = [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR];

/**
 * Purpose: route table for the SPA.
 * AC: SCRUM-65 AC1, AC5 — Lead-only `/app/events/unassigned`, then event detail for a queued request.
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/app"
            element={(
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            )}
          >
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<ProtectedRoute allowedRoles={requestRoles}><NewEvent /></ProtectedRoute>} />
            <Route path="events/:id/edit" element={<ProtectedRoute allowedRoles={requestRoles}><NewEvent /></ProtectedRoute>} />
            <Route path="drafts" element={<ProtectedRoute allowedRoles={requestRoles}><Drafts /></ProtectedRoute>} />
            {/* SCRUM-65 AC1: Lead unassigned queue. Before events/:id so "unassigned" is not an id. */}
            <Route
              path="events/unassigned"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.EVENT_COORDINATOR_LEAD]}>
                  <UnassignedQueue />
                </ProtectedRoute>
              )}
            />
            {/* Keep booking requests scoped to an event and available only to coordinators. */}
            <Route path="events/:id/venue-booking" element={<ProtectedRoute allowedRoles={[ROLES.EVENT_COORDINATOR]}><VenueBooking /></ProtectedRoute>} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route
              path="venues"
              element={
                <ProtectedRoute allowedRoles={[ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF]}>
                  <Venues />
                </ProtectedRoute>
              }
            />
            {/* SCRUM-66 AC6: Event Organisers and Attendees are redirected away. */}
            <Route
              path="venues/availability"
              element={
                <ProtectedRoute allowedRoles={[ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT]}>
                  <VenueAvailability />
                </ProtectedRoute>
              }
            />
            <Route path="equipment" element={<ProtectedRoute allowedRoles={[ROLES.EVENT_COORDINATOR, ROLES.TECHNICAL_SUPPORT]}><Equipment /></ProtectedRoute>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
