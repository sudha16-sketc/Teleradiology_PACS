import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserRole } from '@prisma/client';
import type { AuditAction, AuditResource } from '@axis/types';

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async auditLog(
    actor: Actor,
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action,
      resource,
      resourceId,
      metadata,
    });
  }

  private assertCanManageTemplates(actor: Actor) {
    if (!['ADMIN', 'MANAGER', 'RADIOLOGIST'].includes(actor.role)) {
      throw new ForbiddenException('Only admins, managers, and radiologists can manage templates');
    }
  }

  async list(
    user: Actor,
    filters?: {
      modality?: string;
      subspecialty?: string;
      bodyPart?: string;
      isActive?: boolean;
      search?: string;
    },
  ) {
    const where: Record<string, unknown> = {};

    if (filters?.modality) where.modality = filters.modality;
    if (filters?.subspecialty) where.subspecialty = filters.subspecialty;
    if (filters?.bodyPart) where.bodyPart = { contains: filters.bodyPart, mode: 'insensitive' };
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (user.role === 'RADIOLOGIST') {
      where.createdById = user.id;
    }

    const templates = await this.prisma.reportTemplate.findMany({
      where,
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return { data: templates };
  }

  async getById(id: string, user: Actor) {
    const template = await this.prisma.reportTemplate.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
    });

    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    if (user.role === 'RADIOLOGIST' && template.createdById !== user.id) {
      throw new ForbiddenException('You do not have access to this template');
    }

    return { data: template };
  }

  async create(dto: {
    name: string;
    description?: string;
    modality?: string;
    subspecialty?: string;
    bodyPart?: string;
    clinicalHistory?: string;
    findings?: string;
    impression?: string;
    technique?: string;
    comparison?: string;
    recommendations?: string;
    isActive?: boolean;
  }, actor: Actor) {
    this.assertCanManageTemplates(actor);

    const template = await this.prisma.reportTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        modality: dto.modality as any,
        subspecialty: dto.subspecialty as any,
        bodyPart: dto.bodyPart,
        clinicalHistory: dto.clinicalHistory ?? '',
        findings: dto.findings ?? '',
        impression: dto.impression ?? '',
        technique: dto.technique ?? '',
        comparison: dto.comparison ?? '',
        recommendations: dto.recommendations ?? '',
        isActive: dto.isActive ?? true,
        createdById: actor.id,
      },
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
    });

    await this.auditLog(actor, 'REPORT_TEMPLATE_CREATED' as AuditAction, 'REPORT_TEMPLATE' as AuditResource, template.id, {
      name: template.name,
      modality: template.modality,
      subspecialty: template.subspecialty,
    });

    return { data: template };
  }

  async update(id: string, dto: {
    name?: string;
    description?: string;
    modality?: string;
    subspecialty?: string;
    bodyPart?: string;
    clinicalHistory?: string;
    findings?: string;
    impression?: string;
    technique?: string;
    comparison?: string;
    recommendations?: string;
    isActive?: boolean;
  }, actor: Actor) {
    const existing = await this.prisma.reportTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    if (actor.role === 'RADIOLOGIST' && existing.createdById !== actor.id) {
      throw new ForbiddenException('You can only edit your own templates');
    }

    if (!['ADMIN', 'MANAGER', 'RADIOLOGIST'].includes(actor.role)) {
      throw new ForbiddenException('Only admins, managers, and radiologists can update templates');
    }

    const template = await this.prisma.reportTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        modality: dto.modality as any,
        subspecialty: dto.subspecialty as any,
        bodyPart: dto.bodyPart,
        clinicalHistory: dto.clinicalHistory,
        findings: dto.findings,
        impression: dto.impression,
        technique: dto.technique,
        comparison: dto.comparison,
        recommendations: dto.recommendations,
        isActive: dto.isActive,
      },
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
    });

    await this.auditLog(actor, 'REPORT_TEMPLATE_UPDATED' as AuditAction, 'REPORT_TEMPLATE' as AuditResource, template.id, {
      name: template.name,
    });

    return { data: template };
  }

  async delete(id: string, actor: Actor) {
    const existing = await this.prisma.reportTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    if (actor.role === 'RADIOLOGIST' && existing.createdById !== actor.id) {
      throw new ForbiddenException('You can only delete your own templates');
    }

    if (!['ADMIN', 'MANAGER'].includes(actor.role)) {
      throw new ForbiddenException('Only admins and managers can delete templates');
    }

    await this.prisma.reportTemplate.delete({
      where: { id },
    });

    await this.auditLog(actor, 'REPORT_TEMPLATE_DELETED' as AuditAction, 'REPORT_TEMPLATE' as AuditResource, id, {
      name: existing.name,
    });

    return { success: true };
  }

  async getForStudy(studyUid: string, user: Actor) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: { id: true, modality: true, subspecialty: true, bodyPart: true, hospitalId: true },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    interface TemplateWhere {
      isActive: boolean;
      OR: Array<Record<string, unknown>>;
    }

    const where: TemplateWhere = {
      isActive: true,
      OR: [
        { modality: study.modality },
        { modality: null },
      ],
    };

    if (study.subspecialty) {
      where.OR = [
        ...where.OR,
        { subspecialty: study.subspecialty },
        { subspecialty: null },
      ];
    }

    if (study.bodyPart) {
      where.OR = [
        ...where.OR,
        { bodyPart: { contains: study.bodyPart, mode: 'insensitive' } },
        { bodyPart: null },
      ];
    }

    const templates = await this.prisma.reportTemplate.findMany({
      where,
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return { data: templates };
  }
}