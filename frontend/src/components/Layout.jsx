import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ROLE_LABELS, ROLES } from '../constants';

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  /* 
    This code change checks whether the user is currently viewing the venue booking page so 
    the main layout component can adapt its design (specifically for mobile screens).

    Output Examples:
    true: If location.pathname is "/events/456/venue-booking" (the pattern matches).

    false: If location.pathname is "/events/456" or "/dashboard" (the pattern does not match).
  */
  // Mark the booking page so its layout can hide the navigation sidebar on mobile.
  const isVenueBookingPage = /\/events\/[^/]+\/venue-booking$/.test(location.pathname);

  return (
    <div className={`app-shell${isVenueBookingPage ? ' venue-booking-shell' : ''}`}>
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="logo-dot" />
          ConnectSphere
        </div>
        <nav className="nav">
          <NavLink to="/app">Home</NavLink>
          <NavLink to="/app/events">Events</NavLink>
          {hasRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR) && <NavLink to="/app/events/new">New request</NavLink>}
          {hasRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR) && <NavLink to="/app/drafts">My drafts</NavLink>}
          <NavLink to="/app/calendar">Calendar</NavLink>
          {hasRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF) && (
            <NavLink to="/app/venues">Venues</NavLink>
          )}
          {hasRole(ROLES.EVENT_COORDINATOR, ROLES.TECHNICAL_SUPPORT) && (
            <NavLink to="/app/equipment">Equipment</NavLink>
          )}
          <NavLink to="/app/notifications">Notifications</NavLink>
          <NavLink to="/app/profile">Profile</NavLink>
        </nav>
        <div className="user-chip">
          <strong>{user.fullName}</strong>
          <div className="roles">
            {user.roles.map((role) => (
              <span className="pill" key={role}>{ROLE_LABELS[role] || role}</span>
            ))}
          </div>
          <button
            className="btn ghost"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
