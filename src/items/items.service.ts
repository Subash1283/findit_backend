import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from './entities/item.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { UsersService } from '../users/user.service';
import { join } from 'path';
import { ensureDirSync } from 'fs-extra';
import { Role } from '../users/role.enum';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemStatus, ItemType } from './entities/item.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../reset-password/mailer.service';
import { VisionService } from '../module/ai/vision.service';
import { ILike, Not } from 'typeorm';

import { Dispute } from './entities/dispute.entity';
import { ClaimRequest, ClaimStatus } from './entities/claim-request.entity';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private itemRepository: Repository<Item>,
    @InjectRepository(Dispute)
    private disputeRepository: Repository<Dispute>,
    @InjectRepository(ClaimRequest)
    private claimRequestRepository: Repository<ClaimRequest>,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
    private mailerService: MailerService,
    private visionService: VisionService,
  ) {
    ensureDirSync(join(process.cwd(), 'uploads', 'items'));
  }

  async findAll(): Promise<any[]> {
    const items = await this.itemRepository.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    return items.map((item) => ({
      ...item,
      images: [item.imageFront, item.imageBack].filter(Boolean),
    }));
  }

  async findMine(userId: number): Promise<any[]> {
    const items = await this.itemRepository.find({
      where: { userId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    return items.map((item) => ({
      ...item,
      images: [item.imageFront, item.imageBack].filter(Boolean),
    }));
  }

  async getHeatmapData(): Promise<{ latitude: number; longitude: number }[]> {
    const items = await this.itemRepository.find({
      where: {
        status: ItemStatus.ACTIVE,
      },
      select: ['latitude', 'longitude'],
    });

    return items
      .filter((i) => i.latitude && i.longitude)
      .map((i) => ({
        latitude: parseFloat(i.latitude as any),
        longitude: parseFloat(i.longitude as any),
      }));
  }

  async autoFillDetails(file: Express.Multer.File): Promise<{ title: string; category: string; description: string }> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    const fullPath = join(process.cwd(), 'uploads', 'items', file.filename);
    try {
      const result = await this.visionService.autoFillDetails(fullPath);
      // Clean up the temporary file since it's just for autofill
      const fs = await import('fs');
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      return result;
    } catch (err) {
      const fs = await import('fs');
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      console.error('Vision autoFill error:', err);
      return { title: '', category: 'Other', description: '' };
    }
  }

  async findOne(id: number): Promise<Item> {
    const item = await this.itemRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!item) {
      throw new NotFoundException(`Item #${id} not found`);
    }

    return item;
  }

  async create(
    dto: CreateItemDto,
    files: Express.Multer.File[],
    userId: number,
  ): Promise<Item> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    this.usersService.assertCanPostLostFoundItems(user);

    const category = dto.category.toLowerCase().trim();

    if (category === 'documents') {
      const requiredCount = (dto.documentType === 'passport' || dto.documentType === 'driving_license' || dto.documentType === 'certificate') ? 1 : 2;
      if (!files || files.length !== requiredCount) {
        throw new BadRequestException(
          `Document of type "${dto.documentType.replace('_', ' ') || 'citizenship'}" must have exactly ${requiredCount} image(s)`,
        );
      }
    } else {
      if (!files || files.length < 1) {
        throw new BadRequestException('At least one image is required');
      }
    }

    let imageFront: string = null;
    let imageBack: string = null;

    if (files.length >= 1) {
      imageFront = files[0].filename;
    }

    if (files.length === 2) {
      imageBack = files[1].filename;
    }

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 1);
    const item = this.itemRepository.create({
      ...dto,
      user,
      imageFront,
      imageBack,
      expirationDate,
    });

    let expectedTitle = dto.title;
    if (category === 'documents' && dto.documentType) {
      if (dto.documentType === 'passport') expectedTitle = 'Passport';
      else if (dto.documentType === 'driving_license') expectedTitle = 'Driving License';
      else if (dto.documentType === 'certificate') expectedTitle = 'Certificate';
      else expectedTitle = 'Citizenship Card';
    }

    if (imageFront) {
      try {
        const fullPath = join(process.cwd(), 'uploads', 'items', imageFront);

        const validation = await this.visionService.validateImageMatch(
          fullPath,
          expectedTitle,
          dto.category,
          dto.documentType,
        );
        if (!validation.isMatch) {
          // Delete the uploaded file since validation failed
          const fs = await import('fs');
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
          throw new BadRequestException({
            statusCode: 400,
            error: 'Image Mismatch',
            message:
              validation.reason ||
              'The uploaded image does not match the reported item category or title. Please upload a correct image or update the category.',
            details: {
              title: dto.title,
              category: dto.category,
              isMatch: false,
            },
          });
        }

        item.tags = await this.visionService.analyzeImage(
          fullPath,
          expectedTitle,
          dto.category,
        );
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        console.error('AI Vision error:', err);
      }
    }

    const savedItem = await this.itemRepository.save(item);

    // Send confirmation email with item details and images
    if (user.email) {
      try {
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
        const attachments: { filename: string; path: string; cid: string }[] = [];

          if (savedItem.imageFront) {
            const path = join(process.cwd(), 'uploads', 'items', savedItem.imageFront);
            if (fs.existsSync(path)) {
              attachments.push({
                filename: savedItem.imageFront,
                path: path,
                cid: 'imageFront',
              });
            } else {
              console.error(`Attachment not found: ${path}`);
            }
          }
          if (savedItem.imageBack) {
            const path = join(process.cwd(), 'uploads', 'items', savedItem.imageBack);
            if (fs.existsSync(path)) {
              attachments.push({
                filename: savedItem.imageBack,
                path: path,
                cid: 'imageBack',
              });
            } else {
              console.error(`Attachment not found: ${path}`);
            }
          }

        const typeLabel = savedItem.type === 'lost' ? 'LOST' : 'FOUND';
        const typeColor = savedItem.type === 'lost' ? '#dc2626' : '#16a34a';
        const typeBg = savedItem.type === 'lost' ? '#fef2f2' : '#f0fdf4';
        const typeBorder = savedItem.type === 'lost' ? '#fecaca' : '#bbf7d0';
        const typeIcon = savedItem.type === 'lost' ? '&#128269;' : '&#127881;';
        const rewardText = savedItem.reward > 0 ? `${savedItem.currency} ${savedItem.reward.toFixed(2)}` : 'None';

        const imagesHtml = attachments.length > 0 ? `
              <!-- Item Images -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  ${savedItem.imageFront ? `
                  <td style="padding:0 ${savedItem.imageBack ? '6px' : '0'} 0 0;width:${savedItem.imageBack ? '50%' : '100%'};vertical-align:top;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;">Front</p>
                    <img src="cid:imageFront" alt="Item Front" style="width:100%;max-width:260px;border-radius:10px;border:1px solid #e2e8f0;display:block;" />
                  </td>` : ''}
                  ${savedItem.imageBack ? `
                  <td style="padding:0 0 0 6px;width:50%;vertical-align:top;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;">Back</p>
                    <img src="cid:imageBack" alt="Item Back" style="width:100%;max-width:260px;border-radius:10px;border:1px solid #e2e8f0;display:block;" />
                  </td>` : ''}
                </tr>
              </table>` : '';

        const confirmationHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Item Posted - FindIT</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f4f8;padding:48px 16px;">
    <tr>
      <td align="center">

        <!-- Outer card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#0c1a3a;padding:36px 36px 32px;text-align:center;">
              <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:3px;color:#378add;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                FINDIT
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="width:52px;height:52px;background-color:rgba(55,138,221,0.18);border-radius:26px;text-align:center;vertical-align:middle;font-size:22px;line-height:52px;">
                    &#9989;
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0f6ff;line-height:1.3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                Item Successfully Posted!
              </h1>
              <p style="margin:0;font-size:13px;color:#85b7eb;line-height:1.6;">
                Your ${typeLabel.toLowerCase()} item has been listed on FindIT
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:36px;">

              <!-- Greeting -->
              <p style="margin:0 0 20px;font-size:15px;color:#1a202c;line-height:1.7;">
                Hi <strong style="font-weight:600;">${user.name || 'there'}</strong>,
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
                Your item has been successfully posted on FindIT. We'll notify you immediately if a potential match is found. Here are the details of your posting:
              </p>

              <!-- Type Badge -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td>
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color:${typeBg};border:1px solid ${typeBorder};border-radius:8px;padding:6px 16px;">
                          <span style="font-size:13px;font-weight:700;color:${typeColor};letter-spacing:0.5px;">${typeIcon}&nbsp; ${typeLabel} ITEM</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Item Details Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">

                    <!-- Title -->
                    <p style="margin:0 0 18px;font-size:18px;font-weight:700;color:#0c1a3a;">
                      ${savedItem.title}
                    </p>

                    <!-- Detail Rows -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:100px;vertical-align:top;">Category</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#334155;">${savedItem.category || '—'}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:100px;vertical-align:top;">Location</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#334155;">${savedItem.location || '—'}</td>
                      </tr>
                      ${savedItem.description ? `
                      <tr>
                        <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:100px;vertical-align:top;">Description</td>
                        <td style="padding:6px 0;font-size:13px;color:#334155;line-height:1.6;">${savedItem.description}</td>
                      </tr>` : ''}
                      <tr>
                        <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:100px;vertical-align:top;">Reward</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:600;color:${savedItem.reward > 0 ? '#16a34a' : '#94a3b8'};">${rewardText}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:100px;vertical-align:top;">Posted</td>
                        <td style="padding:6px 0;font-size:13px;color:#334155;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              ${imagesHtml}

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="https://FindIT.app/items/${savedItem.id}" style="display:inline-block;background-color:#0c1a3a;color:#e6f1fb;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px;border-radius:10px;padding:14px 32px;">
                      View Your Listing &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Info Notice -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f8fafc;border-radius:10px;padding:16px 18px;border:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.7;">
                      &#128276;&nbsp; We're actively scanning new listings to find potential matches for your item. You'll receive an email and in-app notification as soon as we find something.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Sign-off -->
              <p style="margin:24px 0 0;font-size:14px;color:#64748b;line-height:1.6;">
                Best of luck,<br />
                <strong style="color:#1a202c;font-weight:600;">The FindIT Team</strong>
              </p>

            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #e2e8f0;font-size:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 36px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">
                You're receiving this because you posted an item on FindIT.
              </p>
              <p style="margin:0;font-size:11px;color:#cbd5e1;">
                &copy; ${new Date().getFullYear()} FindIT &middot; All rights reserved
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

        if (attachments.length > 0) {
          await this.mailerService
            .sendMailWithAttachments(
              user.email,
              `${typeLabel} Item Posted: ${savedItem.title} - FindIT`,
              confirmationHtml,
              attachments,
            )
            .catch((e) => console.error('Post confirmation email error:', e));
        } else {
          await this.mailerService
            .sendMail(
              user.email,
              `${typeLabel} Item Posted: ${savedItem.title} - FindIT`,
              confirmationHtml,
            )
            .catch((e) => console.error('Post confirmation email error:', e));
        }
      } catch (e) {
        console.error('Post confirmation email error:', e);
      }
    }

    this.findMatches(savedItem).catch((err) =>
      console.error('Matching error:', err),
    );

    return savedItem;
  }

  async findMatches(newItem: Item) {
    const oppositeType =
      newItem.type === ItemType.LOST ? ItemType.FOUND : ItemType.LOST;

    const candidates = await this.itemRepository.find({
      where: {
        type: oppositeType,
        status: ItemStatus.ACTIVE,
        userId: Not(newItem.userId),
      },
      relations: ['user'],
    });

    for (const match of candidates) {
      let score = 0;

      // Normalize title words to handle synonyms (e.g., "purse" -> "wallet")
      const rawTitleWords = newItem.title.toLowerCase().split(/\s+/);
      const normalizedTitleWords = rawTitleWords.map((w) => this.normalizeCategory(w));
      const matchTitle = match.title.toLowerCase();
      const matchNormalizedTitle = this.normalizeCategory(matchTitle);
      const titleMatches = normalizedTitleWords.filter(
        (word) => word.length > 2 && matchNormalizedTitle.includes(word),
      );
      if (titleMatches.length > 0) score += 0.5;
      // Additional boost if original titles contain synonym words after normalization
      if (rawTitleWords.some((w) => this.normalizeCategory(w) !== w) && match.title.toLowerCase().includes(this.normalizeCategory(rawTitleWords.find((w) => this.normalizeCategory(w) !== w) || ''))) {
        score += 0.2;
      }

      const visualScore = this.visionService.calculateSimilarity(
        newItem.tags,
        match.tags,
      );
      score += visualScore * 0.4;

      if (newItem.location.toLowerCase() === match.location.toLowerCase())
        score += 0.2;

      if (score >= 0.4) {
        const isHighConfidence = score > 0.7;
        const matchLevel = isHighConfidence
          ? '🔥 HIGH CONFIDENCE MATCH'
          : 'Potential Match';
        const verifiedBadge = match.user?.isVerified ? ' ✅' : '';

        const message = `${matchLevel} found for your ${newItem.type} item: "${newItem.title}"!${verifiedBadge}`;

        await this.notificationsService.create(
          newItem.userId,
          `${matchLevel} for "${newItem.title}"!${verifiedBadge}`,
          `/items/${match.id}`,
        );

        await this.notificationsService.create(
          match.userId,
          `Someone just posted a potential match for your item "${match.title}"!`,
          `/items/${newItem.id}`,
        );

        const confidencePct = Math.round(Math.min(score / 1.1, 1) * 100);
        const barWidth = Math.min(confidencePct, 100);

        const htmlBody = (
          user: any,
          myItem: Item,
          matchedItem: Item,
        ) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Match Found - FindIT</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f4f8;padding:48px 16px;">
    <tr>
      <td align="center">

        <!-- Outer card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#0c1a3a;padding:36px 36px 32px;text-align:center;">
              <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:3px;color:#378add;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                FindIT
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="width:52px;height:52px;background-color:rgba(55,138,221,0.18);border-radius:26px;text-align:center;vertical-align:middle;font-size:22px;line-height:52px;">
                    &#128269;
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0f6ff;line-height:1.3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                We found a potential match
              </h1>
              <p style="margin:0;font-size:13px;color:#85b7eb;line-height:1.6;">
                One of your items may have been located
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:36px;">

              <!-- Greeting -->
              <p style="margin:0 0 20px;font-size:15px;color:#1a202c;line-height:1.7;">
                Hi <strong style="font-weight:600;">${user.name || 'there'}</strong>,
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
                Good news — our system detected a potential match between your lost item and a recently posted listing. Here's a quick comparison:
              </p>

              <!-- Your Item card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                <tr>
                  <td style="background-color:#e6f1fb;border:1px solid #b5d4f4;border-radius:12px;padding:20px 22px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#185fa5;">
                      Your item
                    </p>
                    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#0c447c;">
                      ${myItem.title}
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:3px 18px 3px 0;">
                          <span style="font-size:11px;color:#64748b;">Category&nbsp;</span>
                          <span style="font-size:12px;font-weight:600;color:#185fa5;">${myItem.category || '—'}</span>
                        </td>
                        <td style="padding:3px 0;">
                          <span style="font-size:11px;color:#64748b;">Location&nbsp;</span>
                          <span style="font-size:12px;font-weight:600;color:#185fa5;">${myItem.location || '—'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Connector -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                <tr>
                  <td align="center" style="padding:4px 0;font-size:18px;color:#94a3b8;">&#8597;</td>
                </tr>
              </table>

              <!-- Matched Item card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background-color:#eaf3de;border:1px solid #c0dd97;border-radius:12px;padding:20px 22px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3b6d11;">
                      Matched item
                    </p>
                    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#27500a;">
                      ${matchedItem.title}
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:3px 18px 3px 0;">
                          <span style="font-size:11px;color:#64748b;">Category&nbsp;</span>
                          <span style="font-size:12px;font-weight:600;color:#3b6d11;">${matchedItem.category || '—'}</span>
                        </td>
                        <td style="padding:3px 0;">
                          <span style="font-size:11px;color:#64748b;">Location&nbsp;</span>
                          <span style="font-size:12px;font-weight:600;color:#3b6d11;">${matchedItem.location || '—'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Confidence bar -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#f8fafc;border-radius:10px;padding:16px 20px;border:1px solid #e2e8f0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:12px;color:#64748b;white-space:nowrap;padding-right:14px;">Match confidence</td>
                        <td width="100%">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="background-color:#e2e8f0;border-radius:99px;height:6px;">
                                <table role="presentation" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="background-color:#1d9e75;border-radius:99px;height:6px;width:${barWidth}%;min-width:6px;">&nbsp;</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="font-size:13px;font-weight:600;color:#0f6e56;white-space:nowrap;padding-left:14px;">${confidencePct}%</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="https://FindIT.app/items/${matchedItem.id}" style="display:inline-block;background-color:#0c1a3a;color:#e6f1fb;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px;border-radius:10px;padding:14px 32px;">
                      View Match in FindIT &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Notice -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f8fafc;border-radius:10px;padding:16px 18px;border:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.7;">
                      &#9888;&#65039;&nbsp; If this doesn't look right, you can safely ignore this email. If it does match, connect with the other user through FindIT as soon as possible.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Sign-off -->
              <p style="margin:24px 0 0;font-size:14px;color:#64748b;line-height:1.6;">
                Best of luck,<br />
                <strong style="color:#1a202c;font-weight:600;">The FindIT Team</strong>
              </p>

            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #e2e8f0;font-size:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 36px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">
                You're receiving this because you have an active item on FindIT.
              </p>
              <p style="margin:0;font-size:11px;color:#cbd5e1;">
                &copy; ${new Date().getFullYear()} FindIT &middot; All rights reserved
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

        // Only send match email to the LOST item owner (not the founder)
        const lostItem = newItem.type === ItemType.LOST ? newItem : match;
        const foundItem = newItem.type === ItemType.LOST ? match : newItem;

        if (lostItem.user?.email) {
          await this.mailerService
            .sendMail(
              lostItem.user.email,
              'Potential Match Found! - FindIT',
              htmlBody(lostItem.user, lostItem, foundItem),
            )
            .catch((e) => console.error('Email error:', e));
        }
      }
    }
  }

  async remove(
    id: number,
    userId: number,
    role: Role,
  ): Promise<{ message: string }> {
    const item = await this.findOne(id);

    if (role !== Role.ADMIN && item.user.id !== userId) {
      throw new BadRequestException('Not allowed to delete this item');
    }

    await this.itemRepository.remove(item);

    return { message: 'Item deleted successfully' };
  }

  async update(
    id: number,
    dto: UpdateItemDto,
    files: Express.Multer.File[] = [],
    userId: number,
    role: Role,
  ): Promise<Item> {
    const item = await this.findOne(id);

    if (role !== Role.ADMIN && item.user.id !== userId) {
      throw new BadRequestException('Not allowed to update this item');
    }

    if (dto.title) item.title = dto.title;
    if (dto.category) item.category = dto.category;
    if (dto.documentType !== undefined) item.documentType = dto.documentType;
    if (dto.type) item.type = dto.type;
    if (dto.location) item.location = dto.location;
    if (dto.latitude !== undefined) item.latitude = dto.latitude;
    if (dto.longitude !== undefined) item.longitude = dto.longitude;
    if (dto.description !== undefined) item.description = dto.description;
    if (dto.sensitive !== undefined) item.sensitive = dto.sensitive;
    if (dto.sensitiveBlur !== undefined) item.sensitiveBlur = dto.sensitiveBlur;
    if (dto.blurType !== undefined) item.blurType = dto.blurType;
    if (dto.reward !== undefined) item.reward = dto.reward;
    if (dto.currency) item.currency = dto.currency;
    if (dto.status) item.status = dto.status;



    if (files.length >= 1) {
      item.imageFront = files[0].filename;
    }
    if (files.length === 2) {
      item.imageBack = files[1].filename;
    }

    return this.itemRepository.save(item);
  }

  // Returns the expiration date of an item (if set)
  async getExpirationDate(itemId: number): Promise<Date | null> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException(`Item #${itemId} not found`);
    }
    return item.expirationDate ?? null;
  }

  // Checks whether the item is expired (expirationDate passed and status not solved)
  async isItemExpired(itemId: number): Promise<boolean> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException(`Item #${itemId} not found`);
    }
    if (!item.expirationDate) return false;
    const now = new Date();
    return now > item.expirationDate && item.status !== ItemStatus.SOLVED;
  }

  async getClaimStatus(itemId: number, userId: number): Promise<{
    isBlocked: boolean;
    blockedUntil: Date | null;
    isVerified: boolean;
    canChat: boolean;
  }> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    // Item owner can always chat
    if (item.userId === userId) {
      return { isBlocked: false, blockedUntil: null, isVerified: true, canChat: true };
    }

    // Check if item-level block is active
    const isBlocked = !!(item.claimBlockedUntil && new Date() < item.claimBlockedUntil);

    // Check if this user has an approved claim request for this item
    const approvedRequest = await this.claimRequestRepository.findOne({
      where: { itemId, userId, status: ClaimStatus.APPROVED },
    });

    return {
      isBlocked,
      blockedUntil: isBlocked ? item.claimBlockedUntil : null,
      isVerified: !!approvedRequest,
      canChat: !isBlocked && !!approvedRequest,
    };
  }

  async createClaimRequest(itemId: number, userId: number, proofMessage?: string): Promise<{ message: string }> {
    const item = await this.itemRepository.findOne({ where: { id: itemId }, relations: ['user'] });
    if (!item) throw new NotFoundException('Item not found');
    
    if (item.userId === userId) {
      throw new BadRequestException('You cannot claim your own item');
    }
    
    if (item.status !== ItemStatus.ACTIVE) {
      throw new BadRequestException('This item is no longer available for claiming');
    }

    const existingClaim = await this.claimRequestRepository.findOne({
      where: { itemId, userId, status: ClaimStatus.PENDING },
    });

    if (existingClaim) {
      throw new BadRequestException('You already have a pending claim request for this item');
    }

    const user = await this.usersService.findOne(userId);
    if (!user) throw new BadRequestException('User not found');

    const claimRequest = this.claimRequestRepository.create({
      itemId,
      userId,
      proofMessage,
      status: ClaimStatus.PENDING,
    });
    await this.claimRequestRepository.save(claimRequest);

    // Notify the item owner
    await this.notificationsService.create(
      item.userId,
      `User ${user.name} has requested to claim your item: "${item.title}".`,
      `/dashboard/inbox`
    );

    return { message: 'Claim request submitted successfully.' };
  }

  async getClaimRequests(itemId: number, userId: number): Promise<ClaimRequest[]> {
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    if (item.userId !== userId) {
      throw new BadRequestException('Only the item owner can view claim requests');
    }

    return this.claimRequestRepository.find({
      where: { itemId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async respondToClaimRequest(requestId: number, ownerId: number, status: ClaimStatus): Promise<{ message: string }> {
    const claimRequest = await this.claimRequestRepository.findOne({
      where: { id: requestId },
      relations: ['item', 'user'],
    });

    if (!claimRequest) throw new NotFoundException('Claim request not found');

    if (claimRequest.item.userId !== ownerId) {
      throw new BadRequestException('Only the item owner can respond to claim requests');
    }

    if (claimRequest.status !== ClaimStatus.PENDING) {
      throw new BadRequestException('This claim request has already been processed');
    }

    if (status === ClaimStatus.REJECTED) {
      claimRequest.status = ClaimStatus.REJECTED;
      await this.claimRequestRepository.save(claimRequest);

      await this.notificationsService.create(
        claimRequest.userId,
        `Your claim request for "${claimRequest.item.title}" was rejected.`,
        `/items/${claimRequest.item.id}`
      );
      return { message: 'Claim request rejected.' };
    }

    if (status === ClaimStatus.APPROVED) {
      claimRequest.status = ClaimStatus.APPROVED;
      
      // Generate verification code
      const verificationCode = `FINDIT-${Math.floor(1000 + Math.random() * 9000)}`;
      claimRequest.verificationCode = verificationCode;
      await this.claimRequestRepository.save(claimRequest);

      // Reject all other pending claims for this item
      const otherPendingClaims = await this.claimRequestRepository.find({
        where: { itemId: claimRequest.itemId, status: ClaimStatus.PENDING },
      });

      for (const pending of otherPendingClaims) {
        pending.status = ClaimStatus.REJECTED;
        await this.claimRequestRepository.save(pending);
        await this.notificationsService.create(
          pending.userId,
          `Your claim request for "${claimRequest.item.title}" was rejected because another claim was approved.`,
          `/items/${claimRequest.item.id}`
        );
      }

      // Update the item
      const item = claimRequest.item;
      item.status = ItemStatus.CLAIMED;
      item.claimedById = claimRequest.userId;
      await this.itemRepository.save(item);

      // Notify the approved user
      await this.notificationsService.create(
        claimRequest.userId,
        `Your claim request for "${item.title}" was APPROVED! Your verification code is ${verificationCode}.`,
        `/dashboard/inbox`
      );

      return { message: 'Claim request approved successfully.' };
    }

    throw new BadRequestException('Invalid status');
  }

  /**
   * Maps a word (or short phrase) to its canonical synonym.
   * Add new synonym pairs here as needed.
   */
  private normalizeCategory(word: string): string {
    const synonymMap: Record<string, string> = {
      // Bags & Wallets
      purse: 'wallet',
      billfold: 'wallet',
      pocketbook: 'wallet',
      handbag: 'bag',
      backpack: 'bag',
      rucksack: 'bag',
      satchel: 'bag',
      suitcase: 'luggage',
      briefcase: 'bag',
      tote: 'bag',
      duffel: 'bag',
      pouch: 'bag',

      // Electronics - Phones
      mobile: 'phone',
      cellphone: 'phone',
      smartphone: 'phone',
      iphone: 'phone',
      android: 'phone',
      galaxy: 'phone',

      // Electronics - Laptops/Tablets
      laptop: 'laptop',
      notebook: 'laptop',
      mac: 'laptop',
      macbook: 'laptop',
      computer: 'laptop',
      pc: 'laptop',
      tablet: 'tablet',
      ipad: 'tablet',
      kindle: 'tablet',

      // Electronics - Audio
      earbuds: 'headphones',
      airpods: 'headphones',
      earphones: 'headphones',
      headset: 'headphones',
      earpods: 'headphones',

      // Accessories
      specs: 'glasses',
      spectacles: 'glasses',
      eyeglasses: 'glasses',
      sunglasses: 'glasses',
      shades: 'glasses',
      wristwatch: 'watch',
      timepiece: 'watch',
      smartwatch: 'watch',
      applewatch: 'watch',

      // Documents / IDs
      card: 'id',
      identification: 'id',
      'id card': 'id',
      citizenship: 'id',
      passport: 'id',
      license: 'id',
      dl: 'id',

      // Keys
      keys: 'key',
      keychain: 'key',
      keyring: 'key',
      fob: 'key',

      // Vehicles
      bike: 'motorbike',
      motorcycle: 'motorbike',
      scooter: 'motorbike',
      cycle: 'bicycle',
      car: 'vehicle',

      // Clothing
      jacket: 'clothing',
      coat: 'clothing',
      sweater: 'clothing',
      hoodie: 'clothing',
      shoes: 'footwear',
      sneakers: 'footwear',
      boots: 'footwear',
    };

    const lower = word.toLowerCase().trim();
    return synonymMap[lower] ?? lower;
  }

  // --- Administrative Features ---

  async createDispute(userId: number, itemId: number, reason: string): Promise<Dispute> {
    const user = await this.usersService.findOne(userId);
    const item = await this.itemRepository.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    const dispute = this.disputeRepository.create({
      reporter: user,
      item: item,
      reason,
      status: 'pending',
    });

    item.status = ItemStatus.DISPUTED;
    await this.itemRepository.save(item);

    return this.disputeRepository.save(dispute);
  }

  // Get a specific dispute for a user on an item
  async getDisputeByItemAndReporter(itemId: number, reporterId: number): Promise<Dispute | null> {
    return this.disputeRepository.findOne({
      where: { item: { id: itemId }, reporter: { id: reporterId } },
      relations: ['reporter', 'item', 'item.user'],
    });
  }

  async getAllDisputes(): Promise<Dispute[]> {
    return this.disputeRepository.find({
      relations: ['reporter', 'item', 'item.user'],
      order: { createdAt: 'DESC' },
    });
  }

  async resolveDispute(id: number, status: string, adminResponse?: string): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id },
      relations: ['reporter', 'item'],
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    dispute.status = status;
    if (adminResponse) dispute.adminResponse = adminResponse;

    const saved = await this.disputeRepository.save(dispute);

    // Notify the reporter that their dispute has been reviewed
    if (dispute.reporter?.id) {
      const itemTitle = dispute.item?.title || 'an item';
      await this.notificationsService.create(
        dispute.reporter.id,
        `Your report on "${itemTitle}" has been reviewed by an admin. Status: ${status}.${adminResponse ? ` Response: ${adminResponse}` : ''}`,
        dispute.item ? `/items/${dispute.item.id}` : '',
        'announcement'
      );
    }

    return saved;
  }

  async getAllClaims(): Promise<ClaimRequest[]> {
    return this.claimRequestRepository.find({
      relations: ['user', 'item', 'item.user'],
      order: { createdAt: 'DESC' },
    });
  }

}
