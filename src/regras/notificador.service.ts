import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

/**
 * E-mail das notificações. Na demonstração vai para o Mailpit (servidor de
 * e-mail de teste, caixa em http://localhost:8025); em produção basta trocar
 * o SMTP_URL.
 */
@Injectable()
export class NotificadorService {
  private readonly logger = new Logger(NotificadorService.name);
  private readonly transporte: Transporter;
  private readonly remetente: string;

  constructor(config: ConfigService) {
    this.transporte = createTransport(
      config.get<string>('SMTP_URL') ?? 'smtp://localhost:1025',
    );
    this.remetente =
      config.get<string>('ALARMES_EMAIL_DE') ?? 'alarmes@itaguari.local';
  }

  async enviar(para: string, assunto: string, texto: string): Promise<void> {
    await this.transporte.sendMail({
      from: this.remetente,
      to: para,
      subject: assunto,
      text: texto,
    });
    this.logger.log(`E-mail enviado a ${para}: ${assunto}`);
  }
}
