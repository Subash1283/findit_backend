import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Role } from '../role.enum';
import { Item } from '../../items/entities/item.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password: string;

  @Column({ type: 'varchar', length: 20 })
  role: Role;

  @Column({ nullable: true, unique: true })
  googleId: string;

  @Column({ nullable: true, default: 'local' })
  provider: string;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ nullable: true })
  verificationDocument: string;

  @Column({ nullable: true })
  verificationDocumentBack: string;

  @Column({ nullable: true })
  verificationDocumentType: string;

  @Column({ default: 'unverified' })
  verificationStatus: string; // 'unverified', 'pending', 'verified', 'rejected'

  @Column({ default: false })
  isSuspended: boolean;

  @Column({ nullable: true })
  suspensionReason: string;

  // 🔗 Relation (User → Items)
  @OneToMany(() => Item, (item) => item.user)
  items: Item[];
}