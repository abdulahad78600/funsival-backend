# Frontend Handoff: Host Dashboard, Earnings, Transactions, and Reservations

This document is the implementation contract for the host-facing screens added
during this backend session. It is written for a React + TypeScript frontend,
but the HTTP contract applies to any client.

## 1. Configuration and authentication

All endpoints below are relative to the backend API base URL:

```env
VITE_API_BASE_URL=https://your-api-domain.com/api/v1
```

Every endpoint requires a JWT for a user whose role is `host`:

```http
Authorization: Bearer <host-jwt-token>
```

The frontend must never use the Stripe secret/restricted key. Stripe credentials
remain on the backend. Store the JWT using the authentication approach already
used by the application; do not put payment API keys in frontend environment
variables.

## 2. Endpoint checklist

| Screen/feature | Method and endpoint |
|---|---|
| Dashboard cards and panels | `GET /dashboard/host/overview` |
| Earnings graph | `GET /payments/connect/earnings` |
| Transaction history | `GET /payments/connect/transactions` |
| Stripe pending/current balance | `GET /payments/connect/balance` |
| Reservations table and filters | `GET /bookings/host` |
| Reservation-page KPI cards | `GET /bookings/host/stats` |
| Filtered CSV download | `GET /bookings/host/export` |
| Full host listings (tabs, search, category) | `GET /listings` |
| Listings-page KPI cards | `GET /listings/host/stats` |
| Toggle listing active/inactive | `PATCH /listings/:listingId/status` |

## 3. Shared API client

Create `src/api/host-dashboard.ts`:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export type ApiEnvelope<T> = {
  success: true;
  message: string;
  data: T;
};

export type ApiFailure = {
  success: false;
  message: string;
  errors?: Record<string, string>;
};

function queryString(
  values: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function apiGet<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  const payload = (await response.json()) as ApiEnvelope<T> | ApiFailure;
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || 'Request failed.');
  }
  return payload.data;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
```

## 4. TypeScript response types

Add these types below the API client, or put them in a separate type file.

```ts
export type CurrencyAmount = {
  currency: string;
  amount: number;
};

export type DashboardEarnings = CurrencyAmount & {
  currentQuarter: number;
  previousQuarter: number;
  // null means the previous quarter was zero, so a percentage is undefined.
  quarterChangePercentage: number | null;
};

export type RecentReservation = {
  id: string;
  status: string;
  bookedAt: string;
  startDate: string;
  endDate: string;
  listing: null | {
    id: string;
    title: string | null;
    category: string | null;
    type: string | null;
    image: string | null;
  };
  customer: null | {
    id: string;
    name: string | null;
    email: string;
  };
};

export type CountAndPercentage = {
  count: number;
  percentage: number;
};

export type DashboardOverview = {
  generatedAt: string;
  cards: {
    totalEarnings: DashboardEarnings[];
    activeListings: { total: number; addedThisMonth: number };
    reservations: { total: number; pending: number };
    completed: { total: number; successRate: number };
  };
  recentReservations: RecentReservation[];
  listingPerformance: {
    total: number;
    completed: CountAndPercentage;
    pending: CountAndPercentage;
    cancelled: CountAndPercentage;
  };
  utilization: {
    basis: 'all_reservations';
    booked: CountAndPercentage;
    pending: CountAndPercentage;
  };
};

export type EarningsPoint = {
  periodStart: string;
  grossEarnings: number;
  platformFees: number;
  netEarnings: number;
  pendingEarnings: number;
  availableEarnings: number;
  refundedEarnings: number;
  disputedEarnings: number;
  bookingCount: number;
  refundCount: number;
  disputeCount: number;
};

export type EarningsSeries = {
  currency: string;
  summary: Omit<EarningsPoint, 'periodStart'>;
  points: EarningsPoint[];
};

export type EarningsRange = '24h' | '7d' | '30d' | '12m';

export type EarningsGraph = {
  range: EarningsRange;
  interval: 'hour' | 'day' | 'month';
  startDate: string;
  endDate: string;
  generatedAt: string;
  series: EarningsSeries[];
};

export type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export type EarningTransaction = {
  id: string;
  type: 'earning';
  direction: 'credit';
  status: 'pending' | 'refunding' | 'processing' | 'available' | 'refunded' | 'disputed';
  amount: number;
  currency: string;
  description: string;
  transactionDate: string;
  booking: {
    id: string;
    grossAmount: number;
    platformFee: number;
    paymentStatus: string;
    releasedAt: string | null;
    refundedAt: string | null;
    listing: null | { id: string; title: string | null };
    customer: null | {
      id: string;
      name: string | null;
      email: string;
    };
  };
};

export type WithdrawalTransaction = {
  id: string;
  type: 'withdrawal';
  direction: 'debit';
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  amount: number;
  currency: string;
  description: string;
  transactionDate: string;
  withdrawal: {
    id: string;
    arrivalDate: string | null;
    paidAt: string | null;
    failedAt: string | null;
    failureReason: string | null;
  };
};

export type Transaction = EarningTransaction | WithdrawalTransaction;

export type TransactionHistory = {
  transactions: Transaction[];
  pagination: Pagination;
};

export type MerchantBalance = {
  accountId: string;
  balances: Array<{
    currency: string;
    pending: number;
    current: number;
    breakdown: {
      sevenDayHold: number;
      stripeProcessing: number;
    };
  }>;
};

export type ReservationTab = 'all' | 'upcoming' | 'completed' | 'cancelled';

export type HostBooking = {
  id: string;
  listing: {
    id: string;
    category: string;
    type: string;
    basicInformation: {
      activityTitle: string;
      location: string;
      description: string;
    };
    photos: string[];
  } | null;
  bookedBy: {
    id: string;
    email: string;
    city: string;
    providerProfile?: { firstName?: string; lastName?: string };
  } | null;
  bookingType: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  totalAmount: number;
  merchantAmount: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  bookedAt: string;
  bookedTime: string;
};

export type ReservationList = {
  bookings: HostBooking[];
  pagination: Pagination;
  filters: {
    tab: ReservationTab;
    search: string | null;
    date: string | null;
    counts: {
      all: number;
      upcoming: number;
      completed: number;
      cancelled: number;
    };
  };
};

export type ReservationStats = {
  // Kept for compatibility with the older stats response.
  upcoming: number;
  completed: number;
  cancelled: number;
  pending: number;
  cards: {
    totalReservations: {
      total: number;
      currentWeek: number;
      previousWeek: number;
      changeFromLastWeek: number;
    };
    revenue: Array<{
      currency: string;
      total: number;
      currentMonth: number;
      previousMonth: number;
      monthChangePercentage: number | null;
    }>;
    activeCustomers: { total: number; newThisWeek: number };
    completionRate: {
      rate: number;
      currentMonthRate: number;
      previousMonthRate: number;
      // This is a percentage-point difference, not relative percent growth.
      changePercentage: number;
    };
  };
  tabs: {
    all: number;
    upcoming: number;
    completed: number;
    cancelled: number;
    pending: number;
  };
};
```

## 5. API service functions

Add these functions to `src/api/host-dashboard.ts`:

```ts
export function getDashboardOverview(
  token: string,
  options: { currency?: string; recentLimit?: number } = {},
  signal?: AbortSignal,
) {
  return apiGet<DashboardOverview>(
    `/dashboard/host/overview${queryString(options)}`,
    token,
    signal,
  );
}

export function getEarningsGraph(
  token: string,
  options: { range: EarningsRange; currency?: string },
  signal?: AbortSignal,
) {
  return apiGet<EarningsGraph>(
    `/payments/connect/earnings${queryString(options)}`,
    token,
    signal,
  );
}

export function getTransactions(
  token: string,
  options: {
    page?: number;
    limit?: number;
    type?: 'all' | 'earning' | 'withdrawal';
    currency?: string;
  } = {},
  signal?: AbortSignal,
) {
  return apiGet<TransactionHistory>(
    `/payments/connect/transactions${queryString(options)}`,
    token,
    signal,
  );
}

export function getMerchantBalance(token: string, signal?: AbortSignal) {
  return apiGet<MerchantBalance>('/payments/connect/balance', token, signal);
}

export function getReservations(
  token: string,
  options: {
    tab?: ReservationTab;
    search?: string;
    date?: string;
    page?: number;
    limit?: number;
  } = {},
  signal?: AbortSignal,
) {
  return apiGet<ReservationList>(
    `/bookings/host${queryString(options)}`,
    token,
    signal,
  );
}

export function getReservationStats(token: string, signal?: AbortSignal) {
  return apiGet<ReservationStats>('/bookings/host/stats', token, signal);
}

export async function downloadReservationsCsv(
  token: string,
  options: { tab?: ReservationTab; search?: string; date?: string } = {},
) {
  const response = await fetch(
    `${API_BASE_URL}/bookings/host/export${queryString(options)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const error = (await response.json()) as ApiFailure;
    throw new Error(error.message || 'Could not export reservations.');
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `funsival-reservations-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
```

## 6. Dashboard screen implementation

Load the overview and the selected earnings range independently. This allows
the range tabs to refresh only the chart.

```tsx
const [range, setRange] = useState<EarningsRange>('12m');
const [currency, setCurrency] = useState('USD');
const [overview, setOverview] = useState<DashboardOverview | null>(null);
const [earnings, setEarnings] = useState<EarningsGraph | null>(null);

useEffect(() => {
  const controller = new AbortController();
  getDashboardOverview(token, { currency, recentLimit: 5 }, controller.signal)
    .then(setOverview)
    .catch((error) => {
      if (!isAbortError(error)) setError(errorMessage(error));
    });
  return () => controller.abort();
}, [token, currency]);

useEffect(() => {
  const controller = new AbortController();
  getEarningsGraph(token, { range, currency }, controller.signal)
    .then(setEarnings)
    .catch((error) => {
      if (!isAbortError(error)) setError(errorMessage(error));
    });
  return () => controller.abort();
}, [token, range, currency]);
```

Map the screenshot widgets as follows:

| UI element | Response field |
|---|---|
| Total earnings | `cards.totalEarnings[0].amount` after selecting a currency |
| Quarter comparison | `cards.totalEarnings[0].quarterChangePercentage` |
| Active listings | `cards.activeListings.total` |
| Added this month | `cards.activeListings.addedThisMonth` |
| Reservations | `cards.reservations.total` |
| Pending reservations | `cards.reservations.pending` |
| Completed | `cards.completed.total` |
| Success rate | `cards.completed.successRate` |
| Recent reservations | `recentReservations` |
| Donut chart | `listingPerformance.*.percentage` |
| Utilization bars | `utilization.booked.percentage` and `utilization.pending.percentage` |

For the earnings chart, choose the requested currency series:

```ts
const chartSeries = earnings?.series.find((item) => item.currency === currency);
const chartData = chartSeries?.points.map((point) => ({
  x: point.periodStart,
  net: point.netEarnings,
  pending: point.pendingEarnings,
  available: point.availableEarnings,
})) ?? [];
```

Use the backend-provided zero-filled points directly. Do not generate missing
dates in the frontend. Format labels according to `earnings.interval`:

- `hour`: hour label
- `day`: short date label
- `month`: month label

Never combine different currencies into one total. If no `currency` query is
sent, the backend returns one series per currency.

## 7. Reservations screen implementation

State required by the UI:

```tsx
const [tab, setTab] = useState<ReservationTab>('all');
const [searchInput, setSearchInput] = useState('');
const [search, setSearch] = useState('');
const [date, setDate] = useState<string>(''); // send YYYY-MM-DD
const [page, setPage] = useState(1);
const [result, setResult] = useState<ReservationList | null>(null);
const [stats, setStats] = useState<ReservationStats | null>(null);
```

Debounce search so a request is not sent on every keystroke:

```tsx
useEffect(() => {
  const timer = window.setTimeout(() => {
    setSearch(searchInput.trim());
    setPage(1);
  }, 350);
  return () => window.clearTimeout(timer);
}, [searchInput]);
```

Fetch the table whenever a filter changes:

```tsx
useEffect(() => {
  const controller = new AbortController();
  getReservations(
    token,
    { tab, search, date, page, limit: 10 },
    controller.signal,
  )
    .then(setResult)
    .catch((error) => {
      if (!isAbortError(error)) setError(errorMessage(error));
    });
  return () => controller.abort();
}, [token, tab, search, date, page]);

useEffect(() => {
  const controller = new AbortController();
  getReservationStats(token, controller.signal)
    .then(setStats)
    .catch((error) => {
      if (!isAbortError(error)) setError(errorMessage(error));
    });
  return () => controller.abort();
}, [token]);
```

Reset pagination when the tab or calendar date changes:

```tsx
function selectTab(nextTab: ReservationTab) {
  setTab(nextTab);
  setPage(1);
}

function selectDate(nextDate: string) {
  setDate(nextDate);
  setPage(1);
}
```

Tab labels come from the filtered list response:

```tsx
const tabs: Array<{ value: ReservationTab; label: string }> = [
  { value: 'all', label: `All (${result?.filters.counts.all ?? 0})` },
  { value: 'upcoming', label: `Upcoming (${result?.filters.counts.upcoming ?? 0})` },
  { value: 'completed', label: `Completed (${result?.filters.counts.completed ?? 0})` },
  { value: 'cancelled', label: `Cancelled (${result?.filters.counts.cancelled ?? 0})` },
];
```

The counts returned by the list endpoint reflect the current search and date,
which is usually the desired behavior for table tabs. `stats.tabs` contains the
unfiltered page-wide totals.

Map the four reservation cards:

| Card | Response field |
|---|---|
| Total reservations | `stats.cards.totalReservations.total` |
| Change from last week | `stats.cards.totalReservations.changeFromLastWeek` |
| Revenue | selected item from `stats.cards.revenue` |
| Revenue change | `monthChangePercentage` |
| Active customers | `stats.cards.activeCustomers.total` |
| New this week | `stats.cards.activeCustomers.newThisWeek` |
| Completion rate | `stats.cards.completionRate.rate` |
| Change from last month | `stats.cards.completionRate.changePercentage` percentage points |

Map each table row:

```ts
function customerName(booking: HostBooking) {
  const profile = booking.bookedBy?.providerProfile;
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  return name || booking.bookedBy?.email || 'Unknown customer';
}

function reservationLabel(booking: HostBooking) {
  if (booking.status === 'completed') return 'Completed';
  if (booking.status === 'cancelled' || booking.status === 'declined') return 'Cancelled';
  if (booking.status === 'pending' || booking.status === 'awaiting_host_approval') {
    return 'Pending';
  }
  if (booking.status === 'confirmed' && new Date(booking.startDate) > new Date()) {
    return 'Upcoming';
  }
  return 'Active';
}

function invoiceLabel(paymentStatus: string) {
  if (paymentStatus === 'refunded') return 'Refunded';
  if (paymentStatus === 'refunding') return 'Refunding';
  if (['held', 'releasing', 'released'].includes(paymentStatus)) return 'Paid';
  if (paymentStatus === 'processing') return 'Processing';
  if (paymentStatus === 'authorized') return 'Authorized';
  if (paymentStatus === 'failed') return 'Failed';
  return 'Payment required';
}
```

Use:

- reservation name: `booking.listing?.basicInformation.activityTitle`
- location: `booking.listing?.basicInformation.location`
- image: `booking.listing?.photos[0]`
- category: `booking.listing?.category`
- invoice: `invoiceLabel(booking.paymentStatus)`
- reserved by: `customerName(booking)`
- date/time: `startDate`, `startTime`, `endTime`
- status: `reservationLabel(booking)`

The calendar value should preferably be sent as `YYYY-MM-DD`. The API also
accepts `MM/DD/YY` and `MM/DD/YYYY`. A multi-day reservation is included if it
overlaps the selected calendar date.

CSV button:

```tsx
<button
  type="button"
  onClick={() => downloadReservationsCsv(token, { tab, search, date })}
>
  Export CSV
</button>
```

The exported CSV uses the same active filters as the table and contains up to
10,000 matching rows.

## 8. Transaction report implementation

Use `getTransactions` when the user clicks **View report**. The endpoint accepts:

- `page` (default `1`)
- `limit` (default `20`, maximum `100`)
- `type`: `all`, `earning`, or `withdrawal`
- `currency`: optional ISO currency

Render credits and debits differently by checking `transaction.direction`.
Narrow the discriminated union with `transaction.type` before accessing
`booking` or `withdrawal`.

```tsx
if (transaction.type === 'earning') {
  return <EarningRow transaction={transaction} />;
}
return <WithdrawalRow transaction={transaction} />;
```

## 9. Loading, empty, and error states

- Show skeletons while the overview, stats, table, or graph is loading.
- `series: []` means there is no earnings currency in the selected period.
- If a currency was explicitly requested, the earnings endpoint returns that
  currency with zero-filled points even when no earnings exist.
- A list with `bookings: []` is a valid empty filter result.
- On `401`, clear the invalid login session and return to login.
- On `403`, show that the route requires a host account.
- Display the backend `message` for `400` validation errors.
- Cancel stale requests with `AbortController`, especially for search and range
  changes.

## 10. Backend metric definitions

- Earnings are the host's net `merchantAmount`, not the guest's gross charge.
- Refunded and disputed payments do not count toward earned revenue.
- Pending earnings are captured funds still in the hold/release flow.
- Available earnings are released to the connected Stripe account; actual bank
  withdrawals are separate debit transactions.
- Reservation completion rate is completed divided by completed + cancelled +
  declined decisions.
- Reservation-page month comparison uses scheduled reservation dates.
- Active customers are unique customers with at least one non-cancelled booking.
- New customers this week are customers whose first non-cancelled reservation
  was created during the current UTC week.
- Currencies must never be added together without an explicit conversion rate;
  the backend intentionally returns separate entries per currency.

## 11. Backend source locations

- Dashboard overview: `src/modules/dashboard/`
- Earnings and transactions: `src/modules/payments/`
- Reservation list, filters, stats, and export: `src/modules/bookings/`
- Listings list, filters, and stats: `src/modules/listings/`
- Route mounts: `src/routes/index.js`

## 12. Listings screen (host)

### Endpoints

| UI element | Endpoint |
| --- | --- |
| Listings KPI cards | `GET /listings/host/stats` |
| Listings table, tabs, search, category filter | `GET /listings` |
| Activate / deactivate a listing | `PATCH /listings/:listingId/status` with `{ "isActive": boolean }` |
| Delete a listing | `DELETE /listings/:listingId` |

### `GET /listings` query parameters

- `page` (default 1), `limit` (default 10, max 100)
- `status`: `all` (default) | `active` | `inactive` | `draft`
- `search`: matches the activity title (case-insensitive)
- `category`: exact category name (case-insensitive) for the All Categories dropdown

Every row carries `status` (`active` | `inactive` | `draft`), `bookingCount`
(confirmed + completed), `reviewSummary` (`overallRating`, `count`, …) for the
Rating column, and `nextAvailability` (`{ date: "YYYY-MM-DD", startTime, endTime }`
or `null`) for the Availability column — the first upcoming slot that is still
available. Drafts always have `nextAvailability: null` and `bookingCount: 0`.

Response shape:

```ts
export type HostListingList = {
  listings: Array<{
    id: string;
    status: 'active' | 'inactive' | 'draft';
    isDraft: boolean;
    category: string | null;
    type: string | null;
    basicInformation?: { activityTitle?: string; location?: string };
    photos?: string[];
    price?: Record<string, unknown>;
    availability?: unknown[];
    bookingCount: number; // confirmed + completed bookings (0 for drafts)
    reviewSummary: {
      count: number; // e.g. "4.8 (156)" -> overallRating (count)
      overallRating: number | null;
      accuracy: number | null;
      quality: number | null;
      communication: number | null;
      value: number | null;
    };
  }>;
  // Tab badge counts; they respect the current search/category filter.
  tabs: { all: number; active: number; inactive: number; draft: number };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
};
```

Notes:

- The `all` tab returns drafts first (newest first), then published listings
  (newest first). Drafts can be partially filled — render missing fields
  defensively and use `isDraft` to swap row actions (e.g. "Continue setup").
- Drafts come from the listing-creation wizard; a host has at most one draft.

### `GET /listings/host/stats`

```ts
export type HostListingStats = {
  cards: {
    totalListings: {
      total: number;
      currentQuarter: number;
      previousQuarter: number;
      quarterChangePercentage: number | null; // "+15% this quarter"
    };
    listingViews: {
      total: number;
      currentMonth: number;
      previousMonth: number;
      monthChangePercentage: number | null; // "+N% this month"
    };
    totalBookings: {
      total: number;
      currentMonth: number;
      previousMonth: number;
      monthChangePercentage: number | null; // "+8% from last month"
    };
    averageRating: {
      rating: number | null; // all-time average, 1 decimal
      reviewCount: number;
      currentMonthRating: number | null;
      previousMonthRating: number | null;
      changeFromLastMonth: number | null; // "+0.2 from last month"
    };
  };
  tabs: { all: number; active: number; inactive: number; draft: number };
};
```

Metric definitions:

- Listing views are recorded server-side each time a listing detail is fetched
  through the public `GET /listings/browse/:listingId` endpoint.
- Total bookings counts confirmed + completed bookings, compared month-over-month
  by booking creation date.
- Average rating uses review `overallRating`; the delta compares the average of
  reviews created this month against last month (null when either month has no
  reviews).
- Change percentages are `null` when the previous period is zero and the current
  period is not (no meaningful baseline).

## 13. Admin listings (admin dashboard)

All endpoints require a bearer token for a user with `role: "admin"`;
any other role receives `403`. They mirror the host Listings screen (KPI
cards, tabs, table) but across every host, with an optional `hostId` scope.

| UI element | Endpoint |
| --- | --- |
| KPI cards (Total Listings, Listing Views, Total Bookings, Avg Rating) + tab counts | `GET /admin/listings/stats` |
| Listings table, tabs (All / Active / Inactive / Draft), search, category and host filters | `GET /admin/listings` |
| Listing detail page | `GET /admin/listings/:listingId` |
| One user's listings (from the user detail page) | `GET /admin/listings?hostId=<userId>` and `GET /admin/listings/stats?hostId=<userId>` |

### `GET /admin/listings/stats`

- `hostId` (optional): scope every card and tab count to one host. Omit for
  platform-wide totals.

Returns exactly the same shape as `GET /listings/host/stats` (see §12):
`cards.totalListings`, `cards.listingViews`, `cards.totalBookings`,
`cards.averageRating`, and `tabs: { all, active, inactive, draft }`.

### `GET /admin/listings` query parameters

- `page` (default 1), `limit` (default 10, max 100)
- `hostId`: restrict the list to a single user's listings (must be a valid user ID)
- `status`: `all` (default) | `active` | `inactive` | `draft`
- `search`: matches activity title, location text, or city (case-insensitive)
- `category`: exact category name (case-insensitive)

Rows use the same shape as the host list (`status`, `isDraft`, `bookingCount`,
`reviewSummary`, `nextAvailability`) plus a populated `host` object. `tabs`
respects `hostId` / `search` / `category` but not `status`.

```ts
type AdminListingsResponse = {
  listings: Array<
    Listing & {
      status: 'active' | 'inactive' | 'draft';
      isDraft: boolean;
      createdBy: string; // host user ID
      host: {
        id: string;
        name: string;
        email: string;
        role: string;
        profileImage: string;
        agencyName: string;
        city: string;
        reviewSummary: ReviewSummary;
      };
      reviewSummary: ReviewSummary;
      bookingCount: number; // confirmed + completed bookings (0 for drafts)
      nextAvailability: { date: string; startTime: string; endTime: string } | null;
    }
  >;
  tabs: { all: number; active: number; inactive: number; draft: number };
  pagination: Pagination;
};
```

### `GET /admin/listings/:listingId`

Returns the same listing object as above (with `host`, `reviewSummary`,
`bookingCount`, `nextAvailability`) plus a `stats` block:

```ts
type AdminListingDetailResponse = {
  listing: AdminListingsResponse['listings'][number] & {
    stats: {
      viewCount: number; // total recorded public detail views
      bookingCount: number; // confirmed + completed
      totalBookings: number; // every booking regardless of status
      bookingsByStatus: {
        pending: number;
        awaiting_host_approval: number;
        confirmed: number;
        declined: number;
        cancelled: number;
        completed: number;
      };
    };
  };
};
```

Admin detail fetches do not record a listing view. Unknown IDs return `404`;
malformed IDs return `400`.

Backend source: `src/modules/listings/listings.routes.js` (`adminRouter`, mounted
at `/admin/listings` in `src/routes/index.js`),
`listings.controller.js` (`getAdminListingsHandler`, `getAdminListingStatsHandler`,
`getAdminListingByIdHandler`), `listings.service.js` (`queryListings`,
`getListingsForAdmin`, `getAdminListingStats`, `getListingForAdmin`).

## 14. Admin users (admin dashboard)

Both endpoints require a bearer token for a user with `role: "admin"`.

| UI element | Endpoint |
| --- | --- |
| Users table, role tabs (All / User / Host / Admin), search, pagination | `GET /admin/users` |
| User detail page | `GET /admin/users/:userId` |
| "Listings" tab on a user detail page | `GET /admin/listings?hostId=<userId>` + `GET /admin/listings/stats?hostId=<userId>` |

### `GET /admin/users` query parameters

- `page` (default 1), `limit` (default 10, max 100)
- `role`: `all` (default) | `user` | `host` | `admin`
- `search`: case-insensitive match on email, agency name, city, first/last
  name, business name, or phone number

```ts
type AdminUser = {
  id: string;
  role: 'user' | 'host' | 'admin';
  email: string;
  name: string;            // first + last name, else agency name, else email
  agencyName: string;
  city: string;
  phoneNumber: string;
  profileImage: string;
  isEmailVerified: boolean;
  twoFactorEnabled: boolean;
  authProviders: string[]; // e.g. ["local"], ["google"]
  providerProfile: ProviderProfile | null;
  preferences: { amenities: string[]; equipments: string[]; services: string[] };
  stripeConnect: {
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    onboardedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
  stats: {
    listings: { total: number; active: number; inactive: number; draft: number };
    bookings: { asGuest: number; asHost: number };
    rating: { average: number | null; count: number }; // reviews received as host
  };
};

type AdminUsersResponse = {
  users: AdminUser[];
  tabs: { all: number; user: number; host: number; admin: number }; // respects search
  pagination: Pagination;
};
```

Passwords, reset tokens, verification codes, device tokens, and Stripe IDs are
never returned.

### `GET /admin/users/:userId`

Returns `{ user: AdminUser }` with an extended `stats`:

```ts
stats: AdminUser['stats'] & {
  bookings: {
    asGuest: number;
    asHost: number;
    asGuestByStatus: Record<BookingStatus, number>; // zero-filled
    asHostByStatus: Record<BookingStatus, number>;  // zero-filled
  };
  reviewsWritten: number;
};
```

Malformed IDs return `400 Invalid user ID.`; unknown IDs return `404 User not found.`

Backend source: `src/modules/users/users.routes.js` (`adminRouter`, mounted at
`/admin/users` in `src/routes/index.js`), `users.controller.js`
(`listAdminUsersHandler`, `getAdminUserHandler`), `users.service.js`
(`listUsersForAdmin`, `getUserForAdmin`). Tests: `tests/admin-users.test.js`.

## 15. Earnings screen (host)

| UI element | Endpoint |
| --- | --- |
| Available Funds / Pending Balance / Platform Fees cards | `GET /payments/connect/balance` |
| "Stripe Dashboard" button | `POST /payments/connect/login-link` → open `data.url` in a new tab |
| Earnings Trend (Jan–Dec line) + Revenue by Category (donut) | `GET /payments/connect/earnings/overview` |
| Transaction History table | `GET /payments/connect/transactions` |
| Withdraw Balance | `POST /payments/connect/withdrawals` |

### `POST /payments/connect/login-link`

No body. Returns a short-lived Stripe Express dashboard URL:

```json
{ "success": true, "message": "Stripe login link created.", "data": { "url": "https://connect.stripe.com/express/..." } }
```

The link expires quickly, so request it on click (not on page load) and
`window.open(url, '_blank')`. Returns `400 Provider has not started Stripe onboarding.`
when the host has no connected account — hide the button (use
`GET /payments/connect/status`) or send them to `POST /payments/connect/onboard`.

### `GET /payments/connect/earnings/overview`

This is separate from the dashboard's rolling-window graph
(`GET /payments/connect/earnings?range=12m|30d|7d|24h`). It is calendar-year based:

- `year` (optional, default current UTC year; 2000 … next year)
- `currency` (optional, ISO 4217; omit to get one series per currency)

Only bookings whose payment is held, releasing, or released count as revenue
(refunded / disputed bookings are excluded).

```ts
export type EarningsOverview = {
  year: number;
  startDate: string;
  endDate: string;
  generatedAt: string;
  trend: {
    interval: 'month';
    series: Array<{
      currency: string;
      summary: { grossEarnings: number; platformFees: number; netEarnings: number; bookingCount: number };
      peakMonth: { month: number; label: string; netEarnings: number } | null;
      points: Array<{
        month: number;          // 1–12
        label: string;          // "Jan" … "Dec"
        periodStart: string;    // "YYYY-MM-01"
        grossEarnings: number;
        platformFees: number;
        netEarnings: number;    // plot this on the Earnings Trend line
        bookingCount: number;
      }>;                       // always 12 points, zero-filled
    }>;
  };
  revenueByCategory: {
    series: Array<{
      currency: string;
      total: number;            // net earnings across all categories
      categories: Array<{
        key: 'places' | 'equipments' | 'services' | 'other';
        label: 'Places' | 'Equipments' | 'Services' | 'Other';
        grossEarnings: number;
        platformFees: number;
        netEarnings: number;    // donut slice value
        bookingCount: number;
        percentage: number;     // share of `total`, 0–100
      }>;                       // Places / Equipments / Services always present; Other only when non-zero
    }>;
  };
};
```

Category mapping: listing category `place`/`places` → Places,
`equipment`/`equipments` → Equipments, `service`/`services`/`activity`/`activities`
→ Services.

Backend source: `src/modules/payments/payments.service.js` (`getEarningsOverview`,
`createLoginLink`), `payments.controller.js` (`getEarningsOverviewHandler`,
`createLoginLinkHandler`), `payments.routes.js`. Tests: `tests/earnings-overview.test.js`.

## 16. Wishlist (guest)

All wishlist endpoints require a bearer token (any role). Listing IDs are the
`id` from `GET /listings/browse`.

| UI element | Endpoint |
| --- | --- |
| Wishlist page (cards + pagination) | `GET /wishlist?page=1&limit=12` |
| Heart icon on a card (tap) | `POST /wishlist/:listingId/toggle` |
| Explicit add / remove | `POST /wishlist/:listingId` · `DELETE /wishlist/:listingId` |
| Heart state across the app / badge count | `GET /wishlist/summary` → `{ count, listingIds }` |

`GET /listings/browse` and `GET /listings/browse/:listingId` now accept an
**optional** bearer token. When one is sent, every listing carries
`isWishlisted: boolean`; without a token it is always `false`.

### `GET /wishlist`

- `page` (default 1), `limit` (default 12, max 100); newest-saved first.
- Listings deleted since being saved are dropped from `listings` (they may still
  count in `pagination.total` until removed).

```ts
type WishlistResponse = {
  listings: Array<
    Listing & {
      status: 'active' | 'inactive';
      isWishlisted: true;
      wishlistedAt: string;
      host: { id: string; name: string; email: string; role: string; profileImage: string; agencyName: string; city: string; reviewSummary: ReviewSummary };
      reviewSummary: ReviewSummary; // overallRating + count → "4.4 ★ (21K Reviews)"
    }
  >;
  pagination: Pagination;
};
```

Card mapping: image `photos[0]`; title `basicInformation.activityTitle`; chip
`category`; rating `reviewSummary.overallRating` / `.count`; price pills from
`price.hourly` / `price.daily` / `price.perPerson` (+ `price.currency`);
location `placeLocation.city, placeLocation.country`.

### Mutations

```ts
// POST /wishlist/:listingId        → 201 when newly added, 200 if already saved
// DELETE /wishlist/:listingId      → 200 (idempotent)
// POST /wishlist/:listingId/toggle → 200
type WishlistMutationResponse = {
  listingId: string;
  isWishlisted: boolean;
  added?: boolean;   // POST only
  removed?: boolean; // DELETE only
};
```

`400 Invalid listing ID.` for malformed IDs; `404 Listing not found.` when
adding a listing that no longer exists.

Backend source: `src/models/wishlist.model.js`, `src/modules/wishlists/`,
`authenticateOptional` in `src/middlewares/auth.middleware.js`,
`attachWishlistFlags` in `src/modules/listings/listings.service.js`.
Tests: `tests/wishlists.test.js`.

## 17. Reviews (guest)

### Flow

1. **Listing page / booking flow (public)** — show the rating + reviews before the
   guest books: `GET /listings/browse/:listingId` already carries `reviewSummary`
   (`overallRating`, `count`, per-dimension averages). For the reviews section
   call `GET /reviews/listings/:listingId?page=1&limit=5` — it returns the
   summary, a 5★…1★ `distribution`, and the paginated reviews with reviewer info.
   No token needed.
2. **Guest completes the booking** — `GET /bookings` (guest) attaches
   `reviewStatus` + `review` to every booking, so "My bookings" can show a
   *Write a review* button when `reviewStatus.canSubmit` is true, or *Edit* when
   `reviewStatus.canEdit` is true. Reviews are allowed once a booking is
   `confirmed` or `completed`; never while pending / awaiting approval /
   declined / cancelled (`reviewStatus.reason === 'booking_not_reviewable'`).
3. **Review screen** — open with `GET /reviews/bookings/:bookingId/me` to get the
   booking + listing context and the existing review (for edit prefill).
4. **Submit** — `POST /reviews/bookings/:bookingId`. The same call creates or
   updates (one review per booking per guest). The response includes the updated
   `listingReviewSummary` / `hostReviewSummary`, so the UI can refresh the stars
   without refetching.
5. **Delete** — `DELETE /reviews/bookings/:bookingId` removes the guest's review.

### Endpoints

| Purpose | Endpoint | Auth |
| --- | --- | --- |
| Reviews on a listing (+ summary + distribution) | `GET /reviews/listings/:listingId?page&limit` | none |
| Reviews for a provider | `GET /reviews/hosts/:hostId?page&limit` | none |
| Review context for my booking (prefill / can I review?) | `GET /reviews/bookings/:bookingId/me` | user |
| Create or update my review | `POST /reviews/bookings/:bookingId` | user |
| Delete my review | `DELETE /reviews/bookings/:bookingId` | user |

### `POST /reviews/bookings/:bookingId` body

```json
{
  "overallRating": 5,
  "accuracy": 5,
  "quality": 4,
  "communication": 5,
  "value": 4,
  "comment": "Great ride, friendly host."
}
```

All five ratings are required integers 1–5; `comment` is optional (≤ 2000
chars). Errors come back as `400 Validation failed.` with `errors.<field>`.
`403` when the caller is not the booking's guest; `400` when the booking is not
reviewable yet.

### Types

```ts
export type ReviewSummary = {
  count: number;
  overallRating: number | null;
  accuracy: number | null;
  quality: number | null;
  communication: number | null;
  value: number | null;
};

export type RatingBar = { stars: 5 | 4 | 3 | 2 | 1; count: number; percentage: number };

export type Review = {
  id: string;
  booking: string;
  listing: string;
  host: string;
  reviewer: { id: string; name: string; email: string; role: string; profileImage: string; agencyName: string; city: string };
  overallRating: number;
  accuracy: number;
  quality: number;
  communication: number;
  value: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type ListingReviewsResponse = {
  listing: Listing;
  summary: ReviewSummary & { distribution: RatingBar[] }; // 5★ first
  reviews: Review[];
  pagination: Pagination;
};

export type ReviewStatus = {
  canSubmit: boolean;
  canEdit: boolean;
  hasSubmitted: boolean;
  reason: 'only_booking_guest_can_review' | 'booking_not_reviewable' | null;
  reviewId: string;
  submittedAt: string | null;
};

export type BookingReviewContext = {
  booking: {
    id: string; status: string; paymentStatus: string; bookingType: string;
    startDate: string; endDate: string; startTime: string | null; endTime: string | null;
    numberOfGuests: number | null; totalAmount: number; currency: string;
    listing: { id: string; title: string; category: string; type: string; photos: string[] } | null;
    host: Review['reviewer'];
  };
  reviewStatus: ReviewStatus;
  review: Review | null;
  listingReviewSummary?: ReviewSummary; // POST / DELETE only
  hostReviewSummary?: ReviewSummary;    // POST / DELETE only
};
```

Backend source: `src/modules/reviews/`. Tests: `tests/reviews.test.js`.
