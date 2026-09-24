package com.zwj.timer.core;

import java.util.ArrayList;
import java.util.List;

/**
 * 极简的行式序列化：一行一条记录，字段用 tab 分隔，字段里的特殊字符转义。
 * 不依赖 org.json，因此可以在纯 JDK 环境里跑测试。
 */
public final class LineStore {
  private LineStore() {}

  private static final char SEPARATOR = '\t';
  private static final char ESCAPE = '\\';

  public static String join(List<String> fields) {
    StringBuilder line = new StringBuilder();
    for (int i = 0; i < fields.size(); i++) {
      if (i > 0) line.append(SEPARATOR);
      line.append(escape(fields.get(i)));
    }
    return line.toString();
  }

  public static List<String> split(String line) {
    List<String> fields = new ArrayList<>();
    StringBuilder field = new StringBuilder();
    boolean escaped = false;
    for (int i = 0; i < line.length(); i++) {
      char current = line.charAt(i);
      if (escaped) {
        switch (current) {
          case 'n':
            field.append('\n');
            break;
          case 'r':
            field.append('\r');
            break;
          case 't':
            field.append('\t');
            break;
          default:
            field.append(current);
            break;
        }
        escaped = false;
      } else if (current == ESCAPE) {
        escaped = true;
      } else if (current == SEPARATOR) {
        fields.add(field.toString());
        field.setLength(0);
      } else {
        field.append(current);
      }
    }
    fields.add(field.toString());
    return fields;
  }

  /** 把多行文本拆成非空行。 */
  public static List<String> lines(String text) {
    List<String> result = new ArrayList<>();
    if (text == null || text.isEmpty()) return result;
    for (String line : text.split("\n")) {
      if (!line.isEmpty()) result.add(line);
    }
    return result;
  }

  private static String escape(String value) {
    String text = value == null ? "" : value;
    StringBuilder escaped = new StringBuilder();
    for (int i = 0; i < text.length(); i++) {
      char current = text.charAt(i);
      switch (current) {
        case ESCAPE:
          escaped.append(ESCAPE).append(ESCAPE);
          break;
        case '\n':
          escaped.append(ESCAPE).append('n');
          break;
        case '\r':
          escaped.append(ESCAPE).append('r');
          break;
        case SEPARATOR:
          escaped.append(ESCAPE).append('t');
          break;
        default:
          escaped.append(current);
      }
    }
    return escaped.toString();
  }
}
