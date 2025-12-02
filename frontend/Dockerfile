FROM nginx:alpine

# Remove default nginx config and add custom one (to support SPA)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend content
COPY . /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
