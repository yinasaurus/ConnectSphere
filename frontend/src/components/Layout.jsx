import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ROLE_LABELS, ROLES } from '../constants';

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="logo-dot" />
          ConnectSphere
        </div>
        <nav className="nav">
          <NavLink to="/app">Home</NavLink>
          <NavLink to="/app/events">Events</NavLink>
          {hasRole(ROLES.EVENT_ORGANISER) && <NavLink to="/app/events/new">New request</NavLink>}
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
            onClick={() => {
              logout();
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
