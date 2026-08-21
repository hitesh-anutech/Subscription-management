import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MasterDataListType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMasterDataItemDto, UpdateMasterDataItemDto } from './dto/master-data.dto';

// Valid list types the UI is allowed to read/write
const ALLOWED_LIST_TYPES = new Set<string>(Object.values(MasterDataListType));

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  private assertValidType(listType: string): MasterDataListType {
    if (!ALLOWED_LIST_TYPES.has(listType)) {
      throw new BadRequestException(`Invalid list type: ${listType}`);
    }
    return listType as MasterDataListType;
  }

  async list(listType: string) {
    const type = this.assertValidType(listType);
    return this.prisma.masterDataList.findMany({
      where: { listType: type },
      orderBy: [{ displayOrder: 'asc' }, { itemLabel: 'asc' }],
    });
  }

  async create(listType: string, dto: CreateMasterDataItemDto) {
    const type = this.assertValidType(listType);

    const existing = await this.prisma.masterDataList.findUnique({
      where: { uq_master_data: { listType: type, itemValue: dto.itemValue } },
    });
    if (existing) {
      throw new BadRequestException(`Item "${dto.itemValue}" already exists in ${listType}`);
    }

    return this.prisma.masterDataList.create({
      data: {
        listType: type,
        itemValue: dto.itemValue,
        itemLabel: dto.itemLabel ?? dto.itemValue,
        displayOrder: dto.displayOrder ?? 0,
        isSystem: false,
      },
    });
  }

  async update(listType: string, id: string, dto: UpdateMasterDataItemDto) {
    const type = this.assertValidType(listType);
    const item = await this.prisma.masterDataList.findFirst({
      where: { id, listType: type },
    });
    if (!item) throw new NotFoundException(`Item not found`);

    return this.prisma.masterDataList.update({
      where: { id },
      data: {
        ...(dto.itemLabel !== undefined && { itemLabel: dto.itemLabel }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        updatedAt: new Date(),
      },
    });
  }

  async remove(listType: string, id: string) {
    const type = this.assertValidType(listType);
    const item = await this.prisma.masterDataList.findFirst({
      where: { id, listType: type },
    });
    if (!item) throw new NotFoundException(`Item not found`);
    if (item.isSystem) {
      throw new BadRequestException(`System items cannot be deleted`);
    }
    await this.prisma.masterDataList.delete({ where: { id } });
    return { deleted: true };
  }
}
