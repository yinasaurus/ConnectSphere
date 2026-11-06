# Coverage tables

Local run on 6 November 2026. Same totals as the plain test run: backend 1349 passed, frontend 416 passed, 0 failed.

These are the numbers for the slide. The tables below are the full file list.

| Suite | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Backend | 92.85% | 86.65% | 91.84% | 94.09% |
| Frontend | 89.94% | 83.63% | 87.97% | 91.69% |

Coverage is under 100% because some error branches are never taken, `backend/src/config/db.js` is mostly the live database helper, and Cypress is not included in these Jest numbers. The live Supabase test is excluded from Jest.

## Backend

| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered lines |
|---|---:|---:|---:|---:|---|
| All files | 92.85 | 86.65 | 91.84 | 94.09 |  |
| src | 98.04 | 50 | 83.33 | 97.96 |  |
| src/app.js | 100 | 50 | 100 | 100 | 25 |
| src/server.js | 95 | 50 | 80 | 94.44 | 13, 25 |
| src/config | 32.73 | 46.15 | 10 | 33.96 |  |
| src/config/db.js | 19.05 | 11.76 | 10 | 20 | 6-7, 19-23, 27-29, 33-35, 39-41, 45-47, 51-54, 58-60, 70-73, 75-77, 81-82 |
| src/config/env.js | 76.92 | 62.86 | 100 | 76.92 | 3, 9-10, 13-14, 19-24, 27, 30, 33-34 |
| src/constants | 100 | 100 | 100 | 100 |  |
| src/constants/auth.js | 100 | 100 | 100 | 100 |  |
| src/constants/roles.js | 100 | 100 | 100 | 100 |  |
| src/constants/statuses.js | 100 | 100 | 100 | 100 |  |
| src/controllers | 91.11 | 50 | 86.36 | 91.11 |  |
| src/controllers/access.controller.js | 88.89 | 50 | 80 | 88.89 | 10-11, 56 |
| src/controllers/auth.controller.js | 81.25 | 100 | 50 | 81.25 | 19, 23-24 |
| src/controllers/equipment.controller.js | 80 | 100 | 66.67 | 80 | 9-10, 18-19, 27-28 |
| src/controllers/events.controller.js | 93.42 | 50 | 91.67 | 93.42 | 17, 137, 147, 152, 233-234 |
| src/controllers/notifications.controller.js | 100 | 100 | 100 | 100 |  |
| src/controllers/registrations.controller.js | 95.83 | 50 | 100 | 95.83 | 9-10 |
| src/controllers/venues.controller.js | 94.12 | 100 | 93.75 | 94.12 | 109, 113-114 |
| src/domain | 100 | 91.67 | 100 | 100 |  |
| src/domain/statusMachine.js | 100 | 91.67 | 100 | 100 | 57 |
| src/jobs | 100 | 100 | 100 | 100 |  |
| src/jobs/holdExpiry.job.js | 100 | 100 | 100 | 100 |  |
| src/middleware | 85.71 | 69.81 | 95 | 86.67 |  |
| src/middleware/auth.js | 81.82 | 79.17 | 92.86 | 83.67 | 13, 52-53, 55-57, 59, 61, 97, 127-128 |
| src/middleware/errorHandler.js | 88.89 | 60.87 | 100 | 87.5 | 2, 4-5, 7, 14-15, 18-19, 32 |
| src/middleware/validate.js | 100 | 66.67 | 100 | 100 | 7, 9 |
| src/routes | 90.6 | 0 | 50 | 91.84 |  |
| src/routes/access.routes.js | 100 | 100 | 100 | 100 |  |
| src/routes/auth.routes.js | 100 | 100 | 100 | 100 |  |
| src/routes/equipment.routes.js | 100 | 100 | 100 | 100 |  |
| src/routes/events.routes.js | 100 | 100 | 100 | 100 |  |
| src/routes/misc.routes.js | 58.82 | 0 | 50 | 62.5 | 16-17, 25, 29-32, 38-39, 61-62, 67 |
| src/routes/notifications.routes.js | 100 | 100 | 100 | 100 |  |
| src/routes/venues.routes.js | 100 | 100 | 100 | 100 |  |
| src/services | 94.75 | 88.4 | 96.15 | 96.39 |  |
| src/services/access.service.js | 94.09 | 81.28 | 96 | 97.07 | 47, 61-62, 75, 80, 83, 85, 102, 118, 168-169, 176, 206, 265-266, 349, 352, 416, 441, 480, 487-491, 497-500, 543, 565-566, 587, 590, 623, 670, 674, 769, 771, 786, 788 |
| src/services/audit.service.js | 100 | 83.33 | 100 | 100 | 19 |
| src/services/auth.service.js | 56.67 | 43.75 | 66.67 | 62.96 | 27-28, 37-41, 43-44, 46-47 |
| src/services/criticalChange.service.js | 100 | 92.42 | 100 | 100 | 121, 176, 184, 186, 207 |
| src/services/equipment.service.js | 93.41 | 77.18 | 85.71 | 92.94 | 16, 26-27, 30, 32-36, 39-40, 43-45, 62-70, 96-98, 112-113, 120, 131, 155-156, 179, 182, 214, 228-230, 236, 246, 258, 262, 283, 288, 377, 469, 473, 492 |
| src/services/events.service.js | 93.22 | 91.24 | 93.81 | 96.04 | 74, 95, 269, 272-273, 275, 300-303, 421-422, 424-425, 441-442, 445-446, 502, 643, 645, 665, 755, 760, 905, 982-984, 1003, 1010, 1038-1039, 1116, 1367, 1434, 1537, 1596, 1602, 1604, 1610, 1613, 1618-1620, 1622, 1624, 1627, 1631-1632, 1636, 1645, 1671, 1686, 1693-1694, 1697-1698, 1701-1702, 1719, 1724, 1732, 1738, 1743, 1764, 1826-1827, 1842, 1857, 1876, 1885, 2115, 2136, 2242 |
| src/services/notifications.service.js | 100 | 75 | 100 | 100 | 26, 55, 65, 108, 110-111, 120 |
| src/services/registrationSettings.service.js | 100 | 100 | 100 | 100 |  |
| src/services/registrations.service.js | 100 | 100 | 100 | 100 |  |
| src/services/venues.service.js | 96.17 | 90.91 | 98.85 | 97.41 | 52, 57, 204-207, 636, 699, 702, 734, 737, 760-762, 772, 883-885, 891, 896, 905-906, 915-917, 919, 923, 1206, 1249, 1268-1269, 1272, 1297-1298, 1309, 1368, 1381-1382, 1432-1433, 1435-1436, 1462, 1589-1590, 1628-1629, 1651-1653, 1673, 1706, 1732-1736, 1768 |
| src/utils | 100 | 100 | 100 | 100 |  |
| src/utils/asyncHandler.js | 100 | 100 | 100 | 100 |  |
| src/validators | 95.35 | 91.43 | 100 | 95.35 |  |
| src/validators/auth.validators.js | 100 | 100 | 100 | 100 |  |
| src/validators/equipment.validators.js | 86.67 | 82.35 | 100 | 86.67 | 47-49 |
| src/validators/events.validators.js | 100 | 100 | 100 | 100 |  |
| src/validators/venues.validators.js | 100 | 100 | 100 | 100 |  |

## Frontend

| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered lines |
|---|---:|---:|---:|---:|---|
| All files | 89.94 | 83.63 | 87.97 | 91.69 |  |
| src | 78.63 | 57.58 | 92.31 | 83.52 |  |
| src/api.js | 35.29 | 16.67 | 50 | 40 | 7-8, 17, 19-25, 27 |
| src/auth.jsx | 88.46 | 50 | 91.67 | 85.71 | 14, 17, 20, 38-39, 43 |
| src/constants.js | 82.76 | 60 | 100 | 90.91 | 126, 130-134 |
| src/displayError.js | 87.5 | 76.47 | 100 | 91.67 | 35-36, 44, 48, 50 |
| src/formatDateTime.js | 86.21 | 68.75 | 100 | 100 | 10, 29, 40, 51, 64 |
| src/components | 96.44 | 87.25 | 95.24 | 96.62 |  |
| src/components/AffectedBookingsCard.jsx | 96.15 | 75 | 90 | 100 | 24, 29, 35, 39, 88 |
| src/components/AlertBanner.jsx | 100 | 91.67 | 100 | 100 | 12 |
| src/components/AttendeeRegistrationCard.jsx | 100 | 100 | 100 | 100 |  |
| src/components/BlockVenueCard.jsx | 100 | 75 | 100 | 100 | 9, 41-43, 70 |
| src/components/Button.jsx | 100 | 85.71 | 100 | 100 | 22 |
| src/components/ConflictModal.jsx | 100 | 80 | 100 | 100 | 36 |
| src/components/EventDecisionPanel.jsx | 100 | 100 | 100 | 100 |  |
| src/components/EventRegistrationsCard.jsx | 100 | 100 | 100 | 100 |  |
| src/components/FieldError.jsx | 100 | 100 | 100 | 100 |  |
| src/components/Layout.jsx | 79.17 | 75 | 83.33 | 79.17 | 46-48, 51-52, 102, 114, 120-121 |
| src/components/PlaceHoldCard.jsx | 100 | 100 | 100 | 100 |  |
| src/components/ProtectedRoute.jsx | 100 | 100 | 100 | 100 |  |
| src/components/RegistrationSettingsCard.jsx | 100 | 100 | 100 | 100 |  |
| src/components/RescheduleBookingForm.jsx | 100 | 100 | 100 | 100 |  |
| src/components/StatusBadge.jsx | 100 | 79.17 | 100 | 100 | 17, 24-25, 31-32 |
| src/components/UnavailabilityList.jsx | 85.71 | 64.29 | 75 | 84.21 | 24, 26, 36, 48, 69, 71, 75 |
| src/pages | 89.67 | 84.18 | 86.35 | 91.29 |  |
| src/pages/AssignmentOverview.jsx | 100 | 100 | 100 | 100 |  |
| src/pages/CalendarPage.jsx | 90.62 | 90 | 80 | 90 | 18, 31, 33, 69 |
| src/pages/Dashboard.jsx | 95.65 | 82.14 | 90.91 | 95 | 17, 81, 94, 99, 137 |
| src/pages/Drafts.jsx | 91.67 | 63.64 | 85.71 | 90.91 | 18-19, 32, 36-37 |
| src/pages/Equipment.jsx | 76.04 | 71.56 | 66.67 | 78.82 | 23, 25, 39, 64, 87-88, 121-122, 130, 136-139, 141, 158, 161, 170-172, 174-177, 179, 196, 222, 232, 240, 242, 245, 300, 310, 315 |
| src/pages/EquipmentRequest.jsx | 93.5 | 71.79 | 92.31 | 97.3 | 20, 24, 26, 61, 64, 67-70, 73, 76, 87, 89, 106, 138, 148, 156, 170, 173-174, 193-194, 196, 303-304, 316-317, 347-348, 372, 381, 383 |
| src/pages/EventDetail.jsx | 94.22 | 96.36 | 88.79 | 94.12 | 20, 149-150, 252, 388, 435, 525, 556, 618, 635, 664, 694, 701, 717, 815, 820-823, 875, 987, 1014, 1029 |
| src/pages/Events.jsx | 72.22 | 74.36 | 80 | 77.42 | 20-23, 70, 72, 74-77, 79-80, 107, 112, 117 |
| src/pages/Login.jsx | 82 | 73.33 | 90 | 81.82 | 16, 22-23, 25, 28-29, 31, 132-135 |
| src/pages/NewEvent.jsx | 80.99 | 77.3 | 69.77 | 82.08 | 64, 100, 103, 110, 133, 135-136, 139, 147, 189, 207-208, 224-226, 228-229, 274-278, 282-290, 297, 312, 329, 331, 333, 343, 345, 352 |
| src/pages/Notifications.jsx | 100 | 93.75 | 100 | 100 | 20 |
| src/pages/SafetyCheck.jsx | 90.2 | 72.86 | 84.21 | 93.75 | 46, 52, 59, 77, 111-113, 118, 120, 122-124, 128, 133, 135, 138, 142, 173, 180, 183, 188, 190 |
| src/pages/SafetyQueue.jsx | 87.5 | 63.64 | 80 | 87.5 | 22-23, 37, 54-55 |
| src/pages/UnassignedQueue.jsx | 100 | 100 | 100 | 100 |  |
| src/pages/VenueAvailability.jsx | 100 | 96.23 | 100 | 100 | 46, 150 |
| src/pages/VenueBooking.jsx | 93.07 | 85.47 | 96.77 | 96.67 | 13, 82, 95, 99, 111, 115, 118, 164, 166-167, 169, 171, 223, 251-252, 257, 268, 299-300, 303, 331, 349 |
| src/pages/Venues.jsx | 91.57 | 84.52 | 89.8 | 93.12 | 19-20, 34-37, 39, 41, 61, 71, 107, 132, 135, 139, 150, 159, 235, 243-244, 250, 254, 259, 284, 356, 369-370, 424, 433, 445, 519, 703, 729, 739, 811, 817-818, 878-879, 883, 899, 921-922, 955, 958 |
