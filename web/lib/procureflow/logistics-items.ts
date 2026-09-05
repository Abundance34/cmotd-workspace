import { db } from "@/lib/db";

export type LogisticsPOItemRow = {
  id: number;
  poId: number;
  itemName: string;
  description: string | null;
  category: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
};

export async function getLogisticsPOItems(): Promise<LogisticsPOItemRow[]> {
  const sql = db();
  const rows = await sql<{
    id: number;
    po_id: number;
    item_name: string;
    description: string | null;
    category: string | null;
    quantity: string | number;
    received: string | number;
  }[]>`
    SELECT poi.id,poi.po_id,poi.item_name,poi.description,poi.category,poi.quantity,
           COALESCE((
             SELECT SUM(rsi.quantity_received)
             FROM receiving_slip_items rsi
             JOIN receiving_slips rs ON rs.id=rsi.slip_id
             WHERE rsi.po_item_id=poi.id AND COALESCE(rs.status,'') <> 'Cancelled'
           ),0) AS received
    FROM purchase_order_items poi
    ORDER BY poi.po_id,poi.id
  `;

  return rows.map((row) => {
    const ordered = Number(row.quantity || 0);
    const received = Number(row.received || 0);
    return {
      id: Number(row.id),
      poId: Number(row.po_id),
      itemName: row.item_name,
      description: row.description,
      category: row.category,
      quantityOrdered: ordered,
      quantityReceived: received,
      quantityRemaining: Math.max(0, ordered - received),
    };
  });
}
