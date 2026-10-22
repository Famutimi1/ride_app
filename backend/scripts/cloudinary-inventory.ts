import { db } from '../src/shared/config/db';
import { readPrivateDocument } from '../src/modules/driver/admin.service';
import { checksum } from '../src/shared/utils/cloudinary';
/** Read-only inventory. Never uploads or removes existing identity documents. */
async function main() {
    const rows = (await db.query<{
        user_id: string;
        license: string | null;
        registration: string | null;
        insurance: string | null;
    }>('SELECT user_id,license_doc_url AS license,vehicle_reg_doc_url AS registration,insurance_doc_url AS insurance FROM driver_profiles ORDER BY user_id')).rows;
    const inventory: Array<{
        userId: string;
        kind: string;
        state: string;
        bytes?: number;
        checksum?: string;
    }> = [];
    for (const row of rows)
        for (const kind of ['license', 'registration', 'insurance'] as const) {
            const reference = row[kind];
            if (!reference?.startsWith('private://'))
                continue;
            try {
                const { bytes } = await readPrivateDocument(row.user_id, reference);
                inventory.push({ userId: row.user_id, kind, state: 'readable', bytes: bytes.length, checksum: checksum(bytes) });
            }
            catch {
                inventory.push({ userId: row.user_id, kind, state: 'unavailable' });
            }
        }
    console.info(JSON.stringify({ mode: 'dry-run', localDocuments: inventory.length, documents: inventory }, null, 2));
}
void main().catch(() => { console.error('Document inventory failed. No files were changed.'); process.exitCode = 1; }).finally(async () => {
    const { stopTripWorkers } = await import('../src/modules/trips/tripQueue.js');
    const { stopPaymentWorkers } = await import('../src/modules/payments/paymentQueue.js');
    await Promise.all([stopTripWorkers(), stopPaymentWorkers()]);
    await db.end();
});
