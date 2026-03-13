import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../db/prisma.service';

type AuditLogRecord = {
  at: string;
  actor: string;
  action: 'RESOLVE_SUCCESS' | 'RESOLVE_FAILED';
  transactionId: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

@Injectable()
export class AdminService {
  private readonly auditLogPath = join(process.cwd(), 'admin-audit.log');

  constructor(private readonly prisma: PrismaService) {}

  async listTransactions(input: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(input.page || 1));
    const limit = Math.min(100, Math.max(1, Number(input.limit || 20)));
    const skip = (page - 1) * limit;

    const status = this.toTransactionStatus(input.status);
    const where = status ? { status } : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              messengerPsid: true,
              fullName: true,
              phone: true,
              language: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  async getTransactionById(id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            messengerPsid: true,
            fullName: true,
            phone: true,
            language: true,
          },
        },
      },
    });

    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  async writeAuditLog(entry: {
    actor: string;
    action: 'RESOLVE_SUCCESS' | 'RESOLVE_FAILED';
    transactionId: string;
    payload: Record<string, unknown>;
    result: Record<string, unknown>;
  }) {
    const line: AuditLogRecord = {
      at: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      transactionId: entry.transactionId,
      payload: entry.payload,
      result: entry.result,
    };

    await fs.appendFile(this.auditLogPath, `${JSON.stringify(line)}\n`, 'utf8');
  }

  async readAuditLogs(limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit || 50)));

    try {
      const content = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const records = lines
        .slice(-safeLimit)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line) as AuditLogRecord;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return {
        totalReturned: records.length,
        items: records,
      };
    } catch {
      return {
        totalReturned: 0,
        items: [],
      };
    }
  }

  private toTransactionStatus(status?: string): TransactionStatus | undefined {
    if (!status) return undefined;
    const normalized = status.toUpperCase().trim();
    const valid = Object.values(TransactionStatus) as string[];
    if (!valid.includes(normalized)) return undefined;
    return normalized as TransactionStatus;
  }
}
