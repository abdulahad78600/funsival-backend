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
| Full host listings | `GET /listings` |

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
- Route mounts: `src/routes/index.js`
