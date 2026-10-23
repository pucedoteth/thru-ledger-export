// The same code as the command-line tool, compiled from src/ (see .github/workflows/pages.yml).
import { exportAccount, toCsv, tradesToCsv, ThruExplorerError } from './lib/index.js';

const ADDRESS = /^ta[A-Za-z0-9_-]{44}$/;
const $ = (id) => document.getElementById(id);
const form = $('export-form');
const addressInput = $('address');
const addressError = $('address-error');
const submit = $('submit');
const progress = $('progress');
const NETWORK_NAMES = { alphanet: 'Alphanet', betanet: 'Betanet' };

let last; // { result, address, network }

// A shared link can carry the address and network: ?address=ta…&network=betanet
const params = new URLSearchParams(location.search);
if (params.get('address')) addressInput.value = params.get('address');
if (NETWORK_NAMES[params.get('network')]) $('network').value = params.get('network');

function showAddressError(message) {
  addressError.textContent = message;
  addressError.hidden = !message;
  addressInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

addressInput.addEventListener('input', () => {
  if (addressError.hidden) return;
  if (ADDRESS.test(addressInput.value.trim())) showAddressError('');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const address = addressInput.value.trim();
  const network = $('network').value;
  if (!ADDRESS.test(address)) {
    showAddressError(address === ''
      ? 'Paste a wallet address to export.'
      : 'That isn’t a Thru address. Thru addresses start with “ta” and are 46 characters long.');
    addressInput.focus();
    return;
  }
  showAddressError('');
  const from = $('from').value || undefined;
  const to = $('to').value || undefined;
  if (from && to && from > to) {
    progress.textContent = 'The “From” date is after the “To” date.';
    return;
  }

  submit.disabled = true;
  progress.textContent = 'Reading the history…';
  try {
    const result = await exportAccount(address, {
      network,
      from,
      to,
      successOnly: $('success-only').checked,
      onProgress: ({ fetched, total, phase }) => {
        progress.textContent = phase === 'list'
          ? `Listing transactions: ${fetched}`
          : `Reading transactions: ${fetched} of ${total}`;
      },
    });
    last = { result, address, network };
    history.replaceState(null, '', `?${new URLSearchParams({ address, network })}`);
    if (result.rows.length === 0) {
      progress.textContent = from || to
        ? 'No transactions in those dates. Widen the dates and try again.'
        : `This address has no transactions on ${NETWORK_NAMES[network]}. Check the network.`;
      $('result').hidden = true;
      return;
    }
    downloadCsv();
    render(result, address, network);
    progress.textContent = `Downloaded ${fileName('csv')}.`;
  } catch (error) {
    progress.textContent = explain(error, network);
  } finally {
    submit.disabled = false;
  }
});

function explain(error, network) {
  if (error instanceof ThruExplorerError && error.status === 404) {
    return `No account found at this address on ${NETWORK_NAMES[network]}. Check the address and the network.`;
  }
  if (error instanceof ThruExplorerError && error.status) {
    return `Thru’s explorer answered with an error (HTTP ${error.status}). Wait a minute and try again.`;
  }
  return 'Couldn’t reach Thru’s explorer (scan.thru.org). Check your connection and try again.';
}

// ---- downloads ----

function fileName(extension, suffix = '') {
  const { address, network, result } = last;
  const period = result.period.from || result.period.to ? `-${result.period.from ?? 'start'}_${result.period.to ?? 'now'}` : '';
  return `thru-ledger-${address.slice(0, 10)}-${network}${period}${suffix}.${extension}`;
}

function save(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadCsv() { save(toCsv(last.result.rows), fileName('csv'), 'text/csv;charset=utf-8'); }

$('again').addEventListener('click', downloadCsv);
$('json').addEventListener('click', () =>
  save(JSON.stringify(last.result, null, 2) + '\n', fileName('json'), 'application/json'));
$('trades').addEventListener('click', () =>
  save(tradesToCsv(last.result.trades), fileName('csv', '-perp-trades'), 'text/csv;charset=utf-8'));

// ---- result ----

function el(tag, attrs = {}, ...children) {
  const node = Object.assign(document.createElement(tag), attrs);
  node.append(...children.filter((child) => child !== undefined && child !== null));
  return node;
}

const shown = (formatted, raw) => formatted || (raw ? `${raw} raw` : 'unknown');

function render(result, address, network) {
  $('result').hidden = false;
  const count = result.rows.length;
  const followed = result.tokenAccountsFollowed.length;
  $('result-meta').textContent =
    `${count} transaction${count === 1 ? '' : 's'} on ${NETWORK_NAMES[network]} for ${address}` +
    (followed ? `, including ${followed} token account${followed === 1 ? '' : 's'}` : '') + '.';

  const footings = $('footings');
  footings.replaceChildren(...result.tokenTotals.map((total) => {
    const figures = [
      ['Opening', shown(total.openingBalance, total.openingBalanceRaw)],
      ['In', shown(total.in, total.inRaw)],
      ['Out', shown(total.out, total.outRaw)],
      ...(total.feesRaw !== undefined ? [['Fees', shown(total.fees ?? '', total.feesRaw)]] : []),
    ];
    const closing = el('div', { className: `fig closing${total.reconciles === true ? ' ok' : ''}` },
      el('span', {}, 'Closing'), el('b', {}, shown(total.closingBalance, total.closingBalanceRaw)));
    const status = total.reconciles === true
      ? el('p', { className: 'status' }, `Reconciles: opening plus in, less out${total.feesRaw !== undefined ? ' and fees' : ''}, equals closing.`)
      : total.reconciles === false
        ? el('p', { className: 'status bad' }, 'Does not reconcile. Some movements may not be decoded; check the CSV against the explorer.')
        : el('p', { className: 'status' }, 'Opening balance unknown, because the exported period starts after the history begins.');
    const row = el('div', { className: 'footing' },
      el('div', { className: 'token', title: total.tokenMint }, total.tokenSymbol || total.tokenMint),
      ...figures.map(([label, value]) => el('div', { className: 'fig' }, el('span', {}, label), el('b', {}, value))),
      closing, status);
    return row;
  }));

  const notes = [];
  const fromChain = result.mintDetails.filter((mint) => mint.source === 'chain');
  if (fromChain.length) notes.push(`Token details read from the chain: ${fromChain.map((m) => m.tokenSymbol || m.tokenMint).join(', ')}.`);
  const unknown = result.mintDetails.filter((mint) => mint.source === 'unknown');
  if (unknown.length) notes.push(`${unknown.length} token${unknown.length === 1 ? ' has' : 's have'} no known ticker or decimals, so ${unknown.length === 1 ? 'its' : 'their'} amounts are raw.`);
  notes.push(`Fees paid by this address: ${result.totalFeesThru} THRU.`);
  if (result.thruCheck?.ok === false) notes.push('Working back from today’s THRU balance doesn’t land on zero, so some THRU moved in a way the tool doesn’t decode.');
  $('notes').textContent = notes.join(' ');

  $('trades').hidden = result.trades.length === 0;

  const newest = [...result.rows].reverse().slice(0, 20);
  $('preview-caption').textContent = count > newest.length
    ? `Newest ${newest.length} of ${count} transactions. The CSV has every transaction and all columns.`
    : 'The CSV has all columns.';
  $('preview').tBodies[0].replaceChildren(...newest.map((row) => {
    const amount = shown(row.amount, row.amountRaw === '' ? '' : row.amountRaw);
    return el('tr', { className: row.succeeded ? '' : 'failed' },
      el('td', {}, row.timestampUtc ? row.timestampUtc.slice(0, 16).replace('T', ' ') : ''),
      el('td', {}, describe(row)),
      el('td', { className: `num${row.direction === 'out' ? ' out' : ''}` },
        row.amountRaw ? `${row.direction === 'out' ? '−' : row.direction === 'in' ? '+' : ''}${amount}` : ''),
      el('td', {}, row.tokenSymbol || (row.tokenMint ? `${row.tokenMint.slice(0, 8)}…` : '')),
      el('td', {}, el('a', { href: row.explorerUrl, target: '_blank', rel: 'noopener' }, `${row.signature.slice(0, 10)}…`)));
  }));
  $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function describe(row) {
  const labels = {
    transfer: row.direction === 'in' ? 'Received' : row.direction === 'out' ? 'Sent' : row.direction === 'self' ? 'Moved between own accounts' : 'Transfer',
    mint_to: 'Minted to this address',
    burn: 'Burned',
    initialize_account: 'Token account created',
    initialize_mint: 'Token created',
    close_account: 'Token account closed',
    account_create: 'Account created',
    wallet_created: 'Wallet created',
    faucet_withdraw: 'From the faucet',
    faucet_deposit: 'To the faucet',
  };
  const label = labels[row.action] ?? (row.action.startsWith('perp_') ? `Perp ${row.action.slice(5)}` : row.action || 'Other');
  return row.succeeded ? label : `${label} (failed)`;
}
